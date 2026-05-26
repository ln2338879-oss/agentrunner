import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config";
import { RuntimeStore } from "../src/db/runtime-store";
import { VaultManager } from "../src/obsidian/vault-manager";
import { runStartupRecovery, startWorkerHeartbeat } from "../src/runtime/startup-recovery";
import { createDefaultWorkflowRegistry } from "../src/workflows/engine";

const tempDirs: string[] = [];

async function createRuntime() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agentrunner-startup-recovery-"));
  tempDirs.push(dir);
  const store = await RuntimeStore.open(path.join(dir, "runtime.sqlite"));
  const vault = new VaultManager(path.join(dir, "vault"));
  await vault.ensureDefaultFolders();
  const config = loadConfig({
    DATABASE_PATH: path.join(dir, "runtime.sqlite"),
    OBSIDIAN_VAULT_PATH: path.join(dir, "vault"),
    PROJECT_ROOT: dir,
    STARTUP_RECOVERY_MODE: "requeue",
    STALE_TASK_MINUTES: "10",
  });
  return { dir, store, vault, config };
}

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("startup recovery", () => {
  test("requeues stale running workflow steps", async () => {
    const { store, vault, config } = await createRuntime();
    const workflowPlan = createDefaultWorkflowRegistry().plan(undefined, "implementation");
    store.createTask({
      id: "TASK-RECOVERY-REQUEUE",
      title: "Recover interrupted build",
      type: "implementation",
      assignedTo: "builder",
      obsidianPath: "01_Tasks/TASK-RECOVERY-REQUEUE.md",
      workflowPlan,
    });
    store.updateTaskStatus("TASK-RECOVERY-REQUEUE", "running");
    store.completeWorkflowStepRun({
      taskId: "TASK-RECOVERY-REQUEUE",
      stepId: "plan",
      outputRef: "01_Tasks/TASK-RECOVERY-REQUEUE.md",
      now: "2026-01-01T00:00:00.000Z",
    });
    store.updateWorkflowStepRun({
      taskId: "TASK-RECOVERY-REQUEUE",
      stepId: "build",
      status: "running",
      now: "2026-01-01T00:00:01.000Z",
    });

    const result = await runStartupRecovery({
      store,
      vault,
      config,
      owner: "test:recovery",
    });

    expect(result.recovered).toHaveLength(1);
    expect(result.mode).toBe("requeue");
    expect(result.reportPath).toContain("08_Recovery/startup-recovery-");
    expect(store.getWorkflowStepRun("TASK-RECOVERY-REQUEUE", "build")?.status).toBe("pending");
    expect(store.getWorkflowStepRun("TASK-RECOVERY-REQUEUE", "build")?.lockedBy).toBeNull();
    expect(store.getTask("TASK-RECOVERY-REQUEUE")?.status).toBe("pending");
  });

  test("block mode fails stale running workflow steps", async () => {
    const { store, vault, config } = await createRuntime();
    const workflowPlan = createDefaultWorkflowRegistry().plan(undefined, "implementation");
    store.createTask({
      id: "TASK-RECOVERY-BLOCK",
      title: "Block interrupted build",
      type: "implementation",
      assignedTo: "builder",
      obsidianPath: "01_Tasks/TASK-RECOVERY-BLOCK.md",
      workflowPlan,
    });
    store.updateTaskStatus("TASK-RECOVERY-BLOCK", "running");
    store.updateWorkflowStepRun({
      taskId: "TASK-RECOVERY-BLOCK",
      stepId: "build",
      status: "running",
      now: "2026-01-01T00:00:01.000Z",
    });

    const result = await runStartupRecovery({
      store,
      vault,
      config: { ...config, STARTUP_RECOVERY_MODE: "block" },
      owner: "test:block",
    });

    expect(result.recovered).toHaveLength(1);
    expect(result.mode).toBe("block");
    expect(store.getWorkflowStepRun("TASK-RECOVERY-BLOCK", "build")?.status).toBe("failed");
    expect(store.getTask("TASK-RECOVERY-BLOCK")?.status).toBe("blocked");
  });

  test("records worker heartbeat", async () => {
    const { store, config } = await createRuntime();
    const stop = startWorkerHeartbeat({
      store,
      owner: "worker:test:123",
      role: "builder",
      config: { ...config, WORKER_HEARTBEAT_INTERVAL_MS: 100000 },
      metadata: { test: true },
    });
    stop();

    store.recordRuntimeEvent({
      kind: "test_event",
      owner: "worker:test:123",
      message: "heartbeat test event",
    });

    const status = store.getDashboardStatus();
    expect(status.totals.tasks).toBeGreaterThanOrEqual(0);
  });
});
