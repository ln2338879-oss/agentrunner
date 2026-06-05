import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RuntimeStore } from "../src/db/runtime-store";
import { createDefaultWorkflowRegistry } from "../src/workflows/engine";

const tempDirs: string[] = [];
const stores: RuntimeStore[] = [];

async function openStore(name: string): Promise<{ store: RuntimeStore; dir: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), `agentrunner-${name}-`));
  tempDirs.push(dir);
  const store = await RuntimeStore.open(path.join(dir, "runtime.sqlite"));
  stores.push(store);
  return { store, dir };
}

afterAll(async () => {
  for (const store of stores) store.close();
  await Promise.allSettled(
    tempDirs.map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })),
  );
});

describe("RuntimeStore task lifecycle", () => {
  test("exposes explicit close for test and process cleanup", async () => {
    const { store } = await openStore("close");
    expect(typeof store.close).toBe("function");
    store.close();
  });

  test("migrates and creates a task", async () => {
    const { store } = await openStore("task");

    const task = store.createTask({
      id: "TASK-store-1",
      title: "Create potion items",
      type: "content",
      assignedTo: "factory",
      obsidianPath: "01_Tasks/TASK-store-1.md",
      sessionId: "SESSION-1",
      groupId: "runebound",
    });

    expect(task.status).toBe("pending");

    const stored = store.getTask("TASK-store-1");
    expect(stored?.title).toBe("Create potion items");
    expect(stored?.assignedTo).toBe("factory");
    expect(stored?.sessionId).toBe("SESSION-1");
  });

  test("updates task status and review round", async () => {
    const { store } = await openStore("status");
    store.createTask({
      id: "TASK-store-2",
      title: "Implement combat",
      type: "implementation",
      assignedTo: "builder",
      obsidianPath: "01_Tasks/TASK-store-2.md",
    });

    store.updateTaskStatus("TASK-store-2", "running");
    store.setTaskReviewRound("TASK-store-2", 2);

    const stored = store.getTask("TASK-store-2");
    expect(stored?.status).toBe("running");
    expect(stored?.currentRound).toBe(2);
  });

  test("transitions task status only through allowed runtime states", async () => {
    const { store } = await openStore("status-machine");
    store.createTask({
      id: "TASK-status-machine",
      title: "State machine",
      type: "implementation",
      assignedTo: "builder",
      obsidianPath: "01_Tasks/TASK-status-machine.md",
    });

    expect(store.transitionTaskStatus("TASK-status-machine", "running")).toBe(true);
    expect(store.transitionTaskStatus("TASK-status-machine", "review_ready")).toBe(true);
    expect(store.transitionTaskStatus("TASK-status-machine", "in_review")).toBe(true);
    expect(store.transitionTaskStatus("TASK-status-machine", "arbiter_requested")).toBe(true);
    expect(store.transitionTaskStatus("TASK-status-machine", "in_arbitration")).toBe(true);
    expect(store.transitionTaskStatus("TASK-status-machine", "approved")).toBe(true);

    expect(store.transitionTaskStatus("TASK-status-machine", "pending")).toBe(false);
    expect(store.getTask("TASK-status-machine")?.status).toBe("approved");
  });
});

describe("RuntimeStore leases and recovery", () => {
  test("acquires, blocks conflicting owner, and releases a lease", async () => {
    const { store } = await openStore("lease");
    store.createTask({
      id: "TASK-lease-1",
      title: "Lease test",
      type: "planning",
      assignedTo: "director",
      obsidianPath: "01_Tasks/TASK-lease-1.md",
    });

    expect(
      store.acquireTaskLease({ taskId: "TASK-lease-1", owner: "worker-a", ttlMinutes: 10 }),
    ).toBe(true);
    expect(
      store.acquireTaskLease({ taskId: "TASK-lease-1", owner: "worker-b", ttlMinutes: 10 }),
    ).toBe(false);

    store.releaseTaskLease({ taskId: "TASK-lease-1", owner: "worker-a" });
    expect(
      store.acquireTaskLease({ taskId: "TASK-lease-1", owner: "worker-b", ttlMinutes: 10 }),
    ).toBe(true);
  });

  test("recovers stale running tasks as blocked", async () => {
    const { store } = await openStore("recovery");
    store.createTask({
      id: "TASK-recover-1",
      title: "Recover stale task",
      type: "implementation",
      assignedTo: "builder",
      obsidianPath: "01_Tasks/TASK-recover-1.md",
    });
    store.updateTaskStatus("TASK-recover-1", "running");

    const recovered = store.recoverStaleTasks({ staleMinutes: 120 });
    expect(recovered.map((task) => task.id)).toContain("TASK-recover-1");
    expect(store.getTask("TASK-recover-1")?.status).toBe("blocked");
  });

  test("refreshes only the owning workflow step lease", async () => {
    const { store } = await openStore("workflow-step-lease-refresh");
    const workflowPlan = createDefaultWorkflowRegistry().plan(undefined, "implementation");
    store.createTask({
      id: "TASK-step-lease-refresh-1",
      title: "Refresh workflow step lease",
      type: "implementation",
      assignedTo: "builder",
      obsidianPath: "01_Tasks/TASK-step-lease-refresh-1.md",
      workflowPlan,
    });
    store.completeWorkflowStepRun({
      taskId: "TASK-step-lease-refresh-1",
      stepId: "plan",
      outputRef: "01_Tasks/TASK-step-lease-refresh-1.md",
      now: "2026-01-01T00:00:00.000Z",
    });
    store.claimReadyWorkflowStep({
      roleId: "builder",
      owner: "worker:builder:a",
      ttlMinutes: 10,
      now: "2026-01-01T00:00:01.000Z",
    });

    expect(
      store.refreshWorkflowStepLease({
        taskId: "TASK-step-lease-refresh-1",
        stepId: "build",
        owner: "worker:builder:b",
        ttlMinutes: 10,
        now: "2026-01-01T00:05:00.000Z",
      }),
    ).toBe(false);
    expect(store.getWorkflowStepRun("TASK-step-lease-refresh-1", "build")?.lockExpiresAt).toBe(
      "2026-01-01T00:10:01.000Z",
    );

    expect(
      store.refreshWorkflowStepLease({
        taskId: "TASK-step-lease-refresh-1",
        stepId: "build",
        owner: "worker:builder:a",
        ttlMinutes: 10,
        now: "2026-01-01T00:05:00.000Z",
      }),
    ).toBe(true);
    expect(store.getWorkflowStepRun("TASK-step-lease-refresh-1", "build")?.lockExpiresAt).toBe(
      "2026-01-01T00:15:00.000Z",
    );
  });
});

describe("RuntimeStore sessions, steering, and artifacts", () => {
  test("reuses open channel sessions and lists recent messages", async () => {
    const { store } = await openStore("session");
    const first = store.getOrCreateSession({ discordChannelId: "channel-1", title: "Runebound" });
    const second = store.getOrCreateSession({
      discordChannelId: "channel-1",
      title: "Runebound again",
    });

    expect(second.id).toBe(first.id);

    store.recordMessage({
      id: "MSG-session-1",
      discordMessageId: "discord-1",
      discordChannelId: "channel-1",
      sessionId: first.id,
      senderRole: "director",
      content: "First design note",
    });

    const messages = store.listRecentSessionMessages(first.id, 5);
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("First design note");
  });

  test("gets task prompt from the first message without querying task fallback", async () => {
    const { store } = await openStore("prompt-message");
    store.recordMessage({
      id: "MSG-prompt-1",
      discordMessageId: "discord-prompt-1",
      discordChannelId: "channel-prompt-1",
      taskId: "TASK-prompt-1",
      senderRole: "director",
      content: "Use the original Discord request.",
    });
    const originalGetTask = store.getTask.bind(store);
    store.getTask = (() => {
      throw new Error("getTask fallback should not run when a prompt message exists.");
    }) as typeof store.getTask;

    expect(store.getTaskPrompt("TASK-prompt-1")).toBe("Use the original Discord request.");

    store.getTask = originalGetTask;
  });

  test("consumes steering messages once", async () => {
    const { store } = await openStore("steering");
    store.recordSteeringMessage({
      id: "STEER-1",
      taskId: "TASK-steer-1",
      discordMessageId: "discord-steer-1",
      content: "Keep monster attack below 5.",
    });

    const first = store.consumeSteeringMessages("TASK-steer-1");
    const second = store.consumeSteeringMessages("TASK-steer-1");

    expect(first).toHaveLength(1);
    expect(first[0].content).toContain("monster attack");
    expect(second).toHaveLength(0);
  });

  test("records reviews and artifacts for a task", async () => {
    const { store } = await openStore("artifact");
    store.createTask({
      id: "TASK-artifact-1",
      title: "Review artifact test",
      type: "content",
      assignedTo: "factory",
      obsidianPath: "01_Tasks/TASK-artifact-1.md",
    });

    store.recordReview({
      id: "REV-1",
      taskId: "TASK-artifact-1",
      verdict: "APPROVED",
      round: 1,
      feedback: "VERDICT: APPROVED",
    });
    store.recordArtifact({
      id: "ART-1",
      taskId: "TASK-artifact-1",
      type: "factory_output",
      path: "06_FactoryOutputs/TASK-artifact-1.md",
      createdBy: "factory",
    });

    expect(store.listTaskReviews("TASK-artifact-1")[0].verdict).toBe("APPROVED");
    expect(store.listTaskArtifacts("TASK-artifact-1")[0].path).toContain("06_FactoryOutputs");
  });

  test("records verification evidence for workflow steps and quality checks", async () => {
    const { store } = await openStore("verification-evidence");
    store.createTask({
      id: "TASK-evidence-1",
      title: "Evidence test",
      type: "implementation",
      assignedTo: "builder",
      obsidianPath: "01_Tasks/TASK-evidence-1.md",
    });

    store.recordVerificationEvidence({
      id: "EVIDENCE-1",
      taskId: "TASK-evidence-1",
      stepId: "build",
      kind: "workflow_step_validation",
      command: "bun run test",
      status: "passed",
      artifactPath: "artifacts/TASK-evidence-1/test.log",
      summary: "24 tests passed",
      createdBy: "builder",
      metadata: { tests: 24 },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    store.recordVerificationEvidence({
      id: "EVIDENCE-2",
      taskId: "TASK-evidence-1",
      kind: "quality_check",
      command: "bun run lint",
      status: "failed",
      artifactPath: "artifacts/TASK-evidence-1/lint.log",
      summary: "1 lint error",
      createdBy: "ci",
      createdAt: "2026-01-01T00:01:00.000Z",
    });

    const evidence = store.listVerificationEvidence("TASK-evidence-1");

    expect(evidence.map((item) => item.id)).toEqual(["EVIDENCE-1", "EVIDENCE-2"]);
    expect(evidence[0].stepId).toBe("build");
    expect(evidence[0].metadataJson).toBe('{"tests":24}');
    expect(evidence[1].status).toBe("failed");
  });
});
