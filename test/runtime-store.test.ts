import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RuntimeStore } from "../src/db/runtime-store";

const tempDirs: string[] = [];

async function openStore(name: string): Promise<{ store: RuntimeStore; dir: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), `agentrunner-${name}-`));
  tempDirs.push(dir);
  const store = await RuntimeStore.open(path.join(dir, "runtime.sqlite"));
  return { store, dir };
}

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("RuntimeStore task lifecycle", () => {
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

    expect(store.acquireTaskLease({ taskId: "TASK-lease-1", owner: "worker-a", ttlMinutes: 10 })).toBe(true);
    expect(store.acquireTaskLease({ taskId: "TASK-lease-1", owner: "worker-b", ttlMinutes: 10 })).toBe(false);

    store.releaseTaskLease({ taskId: "TASK-lease-1", owner: "worker-a" });
    expect(store.acquireTaskLease({ taskId: "TASK-lease-1", owner: "worker-b", ttlMinutes: 10 })).toBe(true);
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
});

describe("RuntimeStore sessions, steering, and artifacts", () => {
  test("reuses open channel sessions and lists recent messages", async () => {
    const { store } = await openStore("session");
    const first = store.getOrCreateSession({ discordChannelId: "channel-1", title: "Runebound" });
    const second = store.getOrCreateSession({ discordChannelId: "channel-1", title: "Runebound again" });

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
});
