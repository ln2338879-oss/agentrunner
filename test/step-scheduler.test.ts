import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config";
import { RuntimeStore } from "../src/db/runtime-store";
import { VaultManager } from "../src/obsidian/vault-manager";
import type { AgentAdapter, AgentRole, AgentRunInput, AgentRunResult } from "../src/runtime/types";
import { createDefaultWorkflowRegistry } from "../src/workflows/engine";
import { StepScheduler } from "../src/workflows/step-scheduler";

const tempDirs: string[] = [];

async function createRuntime() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agentrunner-step-scheduler-"));
  tempDirs.push(dir);
  const store = await RuntimeStore.open(path.join(dir, "runtime.sqlite"));
  const vault = new VaultManager(path.join(dir, "vault"));
  await vault.ensureDefaultFolders();
  const config = loadConfig({
    DATABASE_PATH: path.join(dir, "runtime.sqlite"),
    OBSIDIAN_VAULT_PATH: path.join(dir, "vault"),
    PROJECT_ROOT: dir,
    CLAUDE_CODE_COMMAND: "mock-claude",
    CODEX_COMMAND: "mock-codex",
    STEP_SCHEDULER_MAX_STEPS_PER_CYCLE: "10",
  });
  return { dir, store, vault, config };
}

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

function agent(role: AgentRole, run: (input: AgentRunInput) => AgentRunResult): AgentAdapter {
  return {
    role,
    async run(input: AgentRunInput): Promise<AgentRunResult> {
      return run(input);
    },
  };
}

describe("StepScheduler", () => {
  test("drains ready workflow steps in dependency order during one cycle", async () => {
    const { store, vault, config } = await createRuntime();
    const workflowPlan = createDefaultWorkflowRegistry().plan(undefined, "implementation");

    store.createTask({
      id: "TASK-SCHED-1",
      title: "Implement scheduled workflow",
      type: "implementation",
      assignedTo: "builder",
      obsidianPath: "01_Tasks/TASK-SCHED-1.md",
      workflowPlan,
    });
    store.recordMessage({
      id: "MSG-SCHED-1",
      discordMessageId: "discord-sched-1",
      discordChannelId: "manual",
      taskId: "TASK-SCHED-1",
      senderRole: "director",
      content: "Plan, build, and review this feature.",
    });

    const scheduler = new StepScheduler({
      store,
      vault,
      config,
      agents: [
        agent("director", (input) => ({
          ok: true,
          output: input.prompt.includes("Review Step") ? "VERDICT: APPROVED\nLooks good." : "## Plan\n- Build the feature.\n- Review it.",
        })),
        agent("builder", () => ({ ok: true, output: "Implemented the feature." })),
      ],
      maxStepsPerCycle: 10,
      roleOrder: ["director", "builder", "director"],
    });

    const result = await scheduler.runCycle();

    expect(result.processed).toBe(3);
    expect(result.idle).toBe(false);
    expect(result.results.map((step) => step.stepId)).toEqual(["plan", "build", "review"]);
    expect(result.results[2]?.verdict).toBe("APPROVED");
    expect(store.getWorkflowStepRun("TASK-SCHED-1", "plan")?.status).toBe("completed");
    expect(store.getWorkflowStepRun("TASK-SCHED-1", "build")?.status).toBe("completed");
    expect(store.getWorkflowStepRun("TASK-SCHED-1", "review")?.status).toBe("completed");
    expect(store.getWorkflowStepRun("TASK-SCHED-1", "arbitrate-if-blocked")?.status).toBe("skipped");
    expect(store.getTask("TASK-SCHED-1")?.status).toBe("approved");
  });

  test("returns idle cycle when no ready workflow steps exist", async () => {
    const { store, vault, config } = await createRuntime();
    const scheduler = new StepScheduler({
      store,
      vault,
      config,
      agents: [agent("director", () => ({ ok: true, output: "No work." }))],
      maxStepsPerCycle: 5,
    });

    const result = await scheduler.runCycle();

    expect(result.processed).toBe(0);
    expect(result.idle).toBe(true);
    expect(result.results).toEqual([]);
  });

  test("respects maxStepsPerCycle", async () => {
    const { store, vault, config } = await createRuntime();
    const workflowPlan = createDefaultWorkflowRegistry().plan(undefined, "implementation");

    store.createTask({
      id: "TASK-SCHED-2",
      title: "Only plan this cycle",
      type: "implementation",
      assignedTo: "builder",
      obsidianPath: "01_Tasks/TASK-SCHED-2.md",
      workflowPlan,
    });

    const scheduler = new StepScheduler({
      store,
      vault,
      config,
      agents: [
        agent("director", () => ({ ok: true, output: "## Plan\n- Build it." })),
        agent("builder", () => ({ ok: true, output: "Built." })),
      ],
      maxStepsPerCycle: 1,
      roleOrder: ["director", "builder", "director"],
    });

    const result = await scheduler.runCycle();

    expect(result.processed).toBe(1);
    expect(result.results.map((step) => step.stepId)).toEqual(["plan"]);
    expect(store.getWorkflowStepRun("TASK-SCHED-2", "plan")?.status).toBe("completed");
    expect(store.getWorkflowStepRun("TASK-SCHED-2", "build")?.status).toBe("pending");
  });
});
