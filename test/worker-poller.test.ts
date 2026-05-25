import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config";
import { RuntimeStore } from "../src/db/runtime-store";
import { VaultManager } from "../src/obsidian/vault-manager";
import type { AgentAdapter, AgentRunInput, AgentRunResult } from "../src/runtime/types";
import { WorkerPoller } from "../src/worker/poller";

const tempDirs: string[] = [];

class MockAgent implements AgentAdapter {
  constructor(
    readonly role: "director" | "builder" | "factory",
    private readonly result: AgentRunResult,
  ) {}

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    return {
      ...this.result,
      output: `${this.result.output}\nPROMPT:${input.prompt}`,
    };
  }
}

async function createFixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agentrunner-worker-poller-"));
  tempDirs.push(dir);

  const config = loadConfig({
    PROJECT_ROOT: path.join(dir, "project"),
    OBSIDIAN_VAULT_PATH: path.join(dir, "vault"),
    DATABASE_PATH: path.join(dir, "runtime.sqlite"),
    TASK_LEASE_MINUTES: "30",
  });

  const store = await RuntimeStore.open(config.DATABASE_PATH);
  const vault = new VaultManager(config.OBSIDIAN_VAULT_PATH);
  await vault.ensureDefaultFolders();

  return { dir, config, store, vault };
}

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("WorkerPoller", () => {
  test("claims and completes a pending task for its role", async () => {
    const fixture = await createFixture();

    fixture.store.createTask({
      id: "TASK-worker-1",
      title: "Implement inventory UI",
      type: "implementation",
      assignedTo: "builder",
      obsidianPath: "01_Tasks/TASK-worker-1.md",
    });
    fixture.store.recordMessage({
      id: "MSG-worker-1",
      discordMessageId: "discord-worker-1",
      discordChannelId: "channel-worker",
      taskId: "TASK-worker-1",
      senderRole: "director",
      content: "Build an inventory UI panel.",
    });

    const poller = new WorkerPoller({
      role: "builder",
      owner: "worker:test:builder",
      store: fixture.store,
      vault: fixture.vault,
      agent: new MockAgent("builder", { ok: true, output: "Builder completed task." }),
      config: fixture.config,
    });

    const result = await poller.pollOnce();

    expect(result.claimed).toBe(true);
    expect(result.taskId).toBe("TASK-worker-1");
    expect(result.status).toBe("completed");
    expect(result.reportPath).toBe("05_BuilderReports/TASK-worker-1-builder-worker.md");

    const task = fixture.store.getTask("TASK-worker-1");
    expect(task?.status).toBe("completed");
    expect(task?.lockedBy).toBeNull();

    const artifacts = fixture.store.listTaskArtifacts("TASK-worker-1");
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].path).toBe("05_BuilderReports/TASK-worker-1-builder-worker.md");
  });

  test("does not claim tasks assigned to another role", async () => {
    const fixture = await createFixture();

    fixture.store.createTask({
      id: "TASK-worker-2",
      title: "Generate potion data",
      type: "content",
      assignedTo: "factory",
      obsidianPath: "01_Tasks/TASK-worker-2.md",
    });

    const poller = new WorkerPoller({
      role: "builder",
      owner: "worker:test:builder",
      store: fixture.store,
      vault: fixture.vault,
      agent: new MockAgent("builder", { ok: true, output: "Should not run." }),
      config: fixture.config,
    });

    const result = await poller.pollOnce();

    expect(result.claimed).toBe(false);
    expect(fixture.store.getTask("TASK-worker-2")?.status).toBe("pending");
  });

  test("marks failed worker execution as failed", async () => {
    const fixture = await createFixture();

    fixture.store.createTask({
      id: "TASK-worker-3",
      title: "Broken implementation",
      type: "implementation",
      assignedTo: "builder",
      obsidianPath: "01_Tasks/TASK-worker-3.md",
    });

    const poller = new WorkerPoller({
      role: "builder",
      owner: "worker:test:builder",
      store: fixture.store,
      vault: fixture.vault,
      agent: new MockAgent("builder", {
        ok: false,
        output: "",
        error: "mock builder failed",
      }),
      config: fixture.config,
    });

    const result = await poller.pollOnce();

    expect(result.claimed).toBe(true);
    expect(result.status).toBe("failed");
    expect(result.error).toBe("mock builder failed");
    expect(fixture.store.getTask("TASK-worker-3")?.status).toBe("failed");
    expect(fixture.store.getTask("TASK-worker-3")?.lockedBy).toBeNull();
  });
});
