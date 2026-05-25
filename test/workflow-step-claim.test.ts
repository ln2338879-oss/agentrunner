import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config";
import { RuntimeStore } from "../src/db/runtime-store";
import { VaultManager } from "../src/obsidian/vault-manager";
import type { AgentAdapter, AgentRunInput, AgentRunResult } from "../src/runtime/types";
import { createDefaultWorkflowRegistry } from "../src/workflows/engine";
import { StepExecutor, claimRoleIdForAgentRole } from "../src/workflows/step-executor";
import { WorkerPoller } from "../src/worker/poller";

const tempDirs: string[] = [];

async function createTempRuntime(): Promise<{ store: RuntimeStore; vault: VaultManager; dir: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agentrunner-step-claim-"));
  tempDirs.push(dir);
  const store = await RuntimeStore.open(path.join(dir, "runtime.sqlite"));
  const vault = new VaultManager(path.join(dir, "vault"));
  await vault.ensureDefaultFolders();
  return { store, vault, dir };
}

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

function createMockAgent(output: string, ok = true): AgentAdapter {
  return {
    role: "builder",
    async run(_input: AgentRunInput): Promise<AgentRunResult> {
      return ok ? { ok: true, output } : { ok: false, output, error: "mock failed" };
    },
  };
}

describe("workflow step claim and executor", () => {
  test("maps runtime roles to resolved workflow role ids", () => {
    expect(claimRoleIdForAgentRole("builder")).toBe("builder");
    expect(claimRoleIdForAgentRole("factory")).toBe("generator");
    expect(claimRoleIdForAgentRole("designer")).toBe("designer");
    expect(claimRoleIdForAgentRole("director")).toBe("planner");
  });

  test("claims only dependency-ready workflow steps", async () => {
    const { store } = await createTempRuntime();
    const workflowPlan = createDefaultWorkflowRegistry().plan(undefined, "implementation");

    store.createTask({
      id: "TASK-CLAIM-1",
      title: "Implement feature",
      type: "implementation",
      assignedTo: "builder",
      obsidianPath: "01_Tasks/TASK-CLAIM-1.md",
      workflowPlan,
    });

    expect(store.claimReadyWorkflowStep({
      roleId: "builder",
      owner: "worker:builder",
      ttlMinutes: 30,
      now: "2026-01-01T00:00:00.000Z",
    })).toBeNull();

    store.completeWorkflowStepRun({
      taskId: "TASK-CLAIM-1",
      stepId: "plan",
      outputRef: "01_Tasks/TASK-CLAIM-1.md",
      now: "2026-01-01T00:00:01.000Z",
    });

    const claimed = store.claimReadyWorkflowStep({
      roleId: "builder",
      owner: "worker:builder",
      ttlMinutes: 30,
      now: "2026-01-01T00:00:02.000Z",
    });

    expect(claimed?.stepId).toBe("build");
    expect(claimed?.status).toBe("running");
    expect(claimed?.lockedBy).toBe("worker:builder");
    expect(claimed?.lockExpiresAt).toBe("2026-01-01T00:30:02.000Z");
  });

  test("executes a claimed ready workflow step and writes report artifacts", async () => {
    const { store, vault, dir } = await createTempRuntime();
    const workflowPlan = createDefaultWorkflowRegistry().plan(undefined, "implementation");
    const config = loadConfig({
      DATABASE_PATH: path.join(dir, "runtime.sqlite"),
      OBSIDIAN_VAULT_PATH: path.join(dir, "vault"),
      PROJECT_ROOT: dir,
      CODEX_COMMAND: "mock-codex",
    });

    store.createTask({
      id: "TASK-CLAIM-2",
      title: "Implement feature",
      type: "implementation",
      assignedTo: "builder",
      obsidianPath: "01_Tasks/TASK-CLAIM-2.md",
      workflowPlan,
    });
    store.recordMessage({
      id: "MSG-CLAIM-2",
      discordMessageId: "discord-claim-2",
      discordChannelId: "manual",
      taskId: "TASK-CLAIM-2",
      senderRole: "director",
      content: "Build the feature.",
    });
    store.completeWorkflowStepRun({
      taskId: "TASK-CLAIM-2",
      stepId: "plan",
      outputRef: "01_Tasks/TASK-CLAIM-2.md",
    });

    const executor = new StepExecutor({
      role: "builder",
      owner: "worker:builder",
      store,
      vault,
      agent: createMockAgent("implemented feature"),
      config,
    });

    const result = await executor.runOnce();
    expect(result.claimed).toBe(true);
    expect(result.stepId).toBe("build");
    expect(result.status).toBe("completed");
    expect(result.reportPath).toBe("05_BuilderReports/TASK-CLAIM-2-build-builder-step.md");

    const build = store.getWorkflowStepRun("TASK-CLAIM-2", "build");
    expect(build?.status).toBe("completed");
    expect(build?.lockedBy).toBeNull();
    expect(build?.outputRef).toBe("05_BuilderReports/TASK-CLAIM-2-build-builder-step.md");
    expect(store.listTaskRuns("TASK-CLAIM-2")).toHaveLength(1);
    expect(store.listTaskArtifacts("TASK-CLAIM-2").map((artifact) => artifact.type)).toContain("workflow_step_report");

    const report = await readFile(path.join(dir, "vault", result.reportPath ?? ""), "utf-8");
    expect(report).toContain("Workflow Step: build");
    expect(report).toContain("implemented feature");
  });

  test("worker poller prioritizes workflow steps before legacy pending tasks", async () => {
    const { store, vault, dir } = await createTempRuntime();
    const workflowPlan = createDefaultWorkflowRegistry().plan(undefined, "implementation");
    const config = loadConfig({
      DATABASE_PATH: path.join(dir, "runtime.sqlite"),
      OBSIDIAN_VAULT_PATH: path.join(dir, "vault"),
      PROJECT_ROOT: dir,
      CODEX_COMMAND: "mock-codex",
    });

    store.createTask({
      id: "TASK-CLAIM-3",
      title: "Workflow task",
      type: "implementation",
      assignedTo: "builder",
      obsidianPath: "01_Tasks/TASK-CLAIM-3.md",
      workflowPlan,
    });
    store.recordMessage({
      id: "MSG-CLAIM-3",
      discordMessageId: "discord-claim-3",
      discordChannelId: "manual",
      taskId: "TASK-CLAIM-3",
      senderRole: "director",
      content: "Build workflow task.",
    });
    store.completeWorkflowStepRun({
      taskId: "TASK-CLAIM-3",
      stepId: "plan",
      outputRef: "01_Tasks/TASK-CLAIM-3.md",
    });

    store.createTask({
      id: "TASK-LEGACY-3",
      title: "Legacy task",
      type: "implementation",
      assignedTo: "builder",
      obsidianPath: "01_Tasks/TASK-LEGACY-3.md",
    });

    const poller = new WorkerPoller({
      role: "builder",
      owner: "worker:builder",
      store,
      vault,
      agent: createMockAgent("workflow step done"),
      config,
    });

    const result = await poller.pollOnce();
    expect(result.taskId).toBe("TASK-CLAIM-3");
    expect(result.stepId).toBe("build");
    expect(store.getTask("TASK-LEGACY-3")?.status).toBe("pending");
  });

  test("marks required failed steps and task as failed", async () => {
    const { store, vault, dir } = await createTempRuntime();
    const workflowPlan = createDefaultWorkflowRegistry().plan(undefined, "implementation");
    const config = loadConfig({
      DATABASE_PATH: path.join(dir, "runtime.sqlite"),
      OBSIDIAN_VAULT_PATH: path.join(dir, "vault"),
      PROJECT_ROOT: dir,
      CODEX_COMMAND: "mock-codex",
    });

    store.createTask({
      id: "TASK-CLAIM-4",
      title: "Fail feature",
      type: "implementation",
      assignedTo: "builder",
      obsidianPath: "01_Tasks/TASK-CLAIM-4.md",
      workflowPlan,
    });
    store.completeWorkflowStepRun({
      taskId: "TASK-CLAIM-4",
      stepId: "plan",
      outputRef: "01_Tasks/TASK-CLAIM-4.md",
    });

    const result = await new StepExecutor({
      role: "builder",
      owner: "worker:builder",
      store,
      vault,
      agent: createMockAgent("bad output", false),
      config,
    }).runOnce();

    expect(result.status).toBe("failed");
    expect(store.getWorkflowStepRun("TASK-CLAIM-4", "build")?.status).toBe("failed");
    expect(store.getTask("TASK-CLAIM-4")?.status).toBe("failed");
  });
});
