import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config";
import { RuntimeStore } from "../src/db/runtime-store";
import { VaultManager } from "../src/obsidian/vault-manager";
import type { AgentAdapter, AgentRunInput, AgentRunResult } from "../src/runtime/types";
import { createDefaultWorkflowRegistry } from "../src/workflows/engine";
import { StepExecutor } from "../src/workflows/step-executor";

const tempDirs: string[] = [];

async function createRuntime() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agentrunner-human-escalation-"));
  tempDirs.push(dir);
  const store = await RuntimeStore.open(path.join(dir, "runtime.sqlite"));
  const vault = new VaultManager(path.join(dir, "vault"));
  await vault.ensureDefaultFolders();
  const config = loadConfig({
    DATABASE_PATH: path.join(dir, "runtime.sqlite"),
    OBSIDIAN_VAULT_PATH: path.join(dir, "vault"),
    PROJECT_ROOT: dir,
    CODEX_COMMAND: "mock-codex",
  });
  return { store, vault, config };
}

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

function manualActionBuilder(): AgentAdapter {
  return {
    role: "builder",
    async run(_input: AgentRunInput): Promise<AgentRunResult> {
      return {
        ok: false,
        output: "# Human Intervention Required\n\nManual account action is required before retry.",
        error: "Manual account action required.",
        errorKind: "usage_limit",
        needsHuman: true,
      };
    },
  };
}

describe("human escalation step executor", () => {
  test("marks task as needs_human when an agent result requests human intervention", async () => {
    const { store, vault, config } = await createRuntime();
    const workflowPlan = createDefaultWorkflowRegistry().plan(undefined, "implementation");
    store.createTask({
      id: "TASK-HUMAN-ESCALATION",
      title: "Build feature",
      type: "implementation",
      assignedTo: "builder",
      obsidianPath: "01_Tasks/TASK-HUMAN-ESCALATION.md",
      workflowPlan,
    });
    store.completeWorkflowStepRun({
      taskId: "TASK-HUMAN-ESCALATION",
      stepId: "plan",
      outputRef: "01_Tasks/TASK-HUMAN-ESCALATION.md",
    });

    const result = await new StepExecutor({
      role: "builder",
      owner: "worker:builder",
      store,
      vault,
      agent: manualActionBuilder(),
      config,
    }).runOnce();

    expect(result.status).toBe("needs_human");
    expect(store.getTask("TASK-HUMAN-ESCALATION")?.status).toBe("needs_human");
    expect(store.getWorkflowStepRun("TASK-HUMAN-ESCALATION", "build")?.status).toBe("failed");
    expect(store.listTaskArtifacts("TASK-HUMAN-ESCALATION").some((artifact) => artifact.type === "human_intervention")).toBe(true);
  });
});
