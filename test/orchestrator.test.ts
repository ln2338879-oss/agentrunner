import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config";
import { RuntimeStore } from "../src/db/runtime-store";
import { VaultManager } from "../src/obsidian/vault-manager";
import { Orchestrator } from "../src/runtime/orchestrator";
import type { AgentAdapter, AgentRunInput, AgentRunResult } from "../src/runtime/types";

const tempDirs: string[] = [];

class MockAgent implements AgentAdapter {
  constructor(
    readonly role: "director" | "builder" | "factory",
    private readonly handler: (input: AgentRunInput) => Promise<AgentRunResult>,
  ) {}

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    return this.handler(input);
  }
}

async function createFixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agentrunner-orchestrator-"));
  tempDirs.push(dir);

  const config = loadConfig({
    PROJECT_ROOT: path.join(dir, "project"),
    OBSIDIAN_VAULT_PATH: path.join(dir, "vault"),
    DATABASE_PATH: path.join(dir, "runtime.sqlite"),
    RECOVER_STALE_TASKS_ON_START: false,
  });

  return {
    dir,
    config,
    store: await RuntimeStore.open(config.DATABASE_PATH),
    vault: new VaultManager(config.OBSIDIAN_VAULT_PATH),
  };
}

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Orchestrator smoke test", () => {
  test("runs worker and review loop until approved", async () => {
    const fixture = await createFixture();

    const orchestrator = new Orchestrator(fixture.store, fixture.vault, fixture.config);

    orchestrator.registerAgent(
      new MockAgent("builder", async () => ({
        ok: true,
        output: "Implemented inventory UI.",
      })),
    );

    orchestrator.registerAgent(
      new MockAgent("factory", async () => ({
        ok: true,
        output: "Generated potion data.",
      })),
    );

    orchestrator.registerAgent(
      new MockAgent("director", async () => ({
        ok: true,
        output: "VERDICT: APPROVED\nImplementation looks correct.",
      })),
    );

    await orchestrator.initialize();

    const result = await orchestrator.handleUserRequest({
      content: "Implement inventory drag and drop UI system.",
      discordChannelId: "discord-channel-1",
      discordMessageId: "discord-message-1",
    });

    expect(result.verdict).toBe("APPROVED");
    expect(result.approvedPath).toContain("07_Approved");

    const task = fixture.store.getTask(result.taskId);
    expect(task?.status).toBe("approved");

    const reviews = fixture.store.listTaskReviews(result.taskId);
    expect(reviews).toHaveLength(1);
    expect(reviews[0].verdict).toBe("APPROVED");

    const artifacts = fixture.store.listTaskArtifacts(result.taskId);
    expect(artifacts.length).toBeGreaterThanOrEqual(3);
  });

  test("marks failed worker execution as failed", async () => {
    const fixture = await createFixture();

    const orchestrator = new Orchestrator(fixture.store, fixture.vault, fixture.config);

    orchestrator.registerAgent(
      new MockAgent("builder", async () => ({
        ok: false,
        output: "",
        error: "builder execution failed",
      })),
    );

    orchestrator.registerAgent(
      new MockAgent("factory", async () => ({
        ok: true,
        output: "Generated fallback content.",
      })),
    );

    orchestrator.registerAgent(
      new MockAgent("director", async () => ({
        ok: true,
        output: "VERDICT: APPROVED",
      })),
    );

    await orchestrator.initialize();

    const result = await orchestrator.handleUserRequest({
      content: "Implement multiplayer combat rollback netcode.",
    });

    const task = fixture.store.getTask(result.taskId);
    expect(task?.status).toBe("failed");
  });
});
