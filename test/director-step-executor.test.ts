import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config";
import { RuntimeStore } from "../src/db/runtime-store";
import { VaultManager } from "../src/obsidian/vault-manager";
import type { AgentAdapter, AgentRunInput, AgentRunResult } from "../src/runtime/types";
import { createDefaultWorkflowRegistry } from "../src/workflows/engine";
import { StepExecutor, claimRoleIdsForAgentRole } from "../src/workflows/step-executor";

const tempDirs: string[] = [];

async function createRuntime() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agentrunner-director-step-"));
  tempDirs.push(dir);
  const store = await RuntimeStore.open(path.join(dir, "runtime.sqlite"));
  const vault = new VaultManager(path.join(dir, "vault"));
  await vault.ensureDefaultFolders();
  const config = loadConfig({
    DATABASE_PATH: path.join(dir, "runtime.sqlite"),
    OBSIDIAN_VAULT_PATH: path.join(dir, "vault"),
    PROJECT_ROOT: dir,
    CLAUDE_CODE_COMMAND: "mock-claude",
  });
  return { dir, store, vault, config };
}

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

function directorAgent(output: string, ok = true): AgentAdapter {
  return {
    role: "director",
    async run(_input: AgentRunInput): Promise<AgentRunResult> {
      return ok ? { ok: true, output } : { ok: false, output, error: "mock failed" };
    },
  };
}

describe("director workflow step execution", () => {
  test("director claims planner reviewer and arbiter role ids", () => {
    expect(claimRoleIdsForAgentRole("director")).toEqual(["planner", "reviewer", "arbiter"]);
  });

  test("director executes a planner step independently", async () => {
    const { store, vault, config } = await createRuntime();
    const workflowPlan = createDefaultWorkflowRegistry().plan(undefined, "implementation");

    store.createTask({
      id: "TASK-DIRECTOR-PLAN",
      title: "Plan feature",
      type: "implementation",
      assignedTo: "builder",
      obsidianPath: "01_Tasks/TASK-DIRECTOR-PLAN.md",
      workflowPlan,
    });
    store.recordMessage({
      id: "MSG-DIRECTOR-PLAN",
      discordMessageId: "discord-director-plan",
      discordChannelId: "manual",
      taskId: "TASK-DIRECTOR-PLAN",
      senderRole: "director",
      content: "Plan then build the feature.",
    });

    const result = await new StepExecutor({
      role: "director",
      owner: "worker:director",
      store,
      vault,
      agent: directorAgent("## Plan\n- Build it\n- Review it"),
      config,
    }).runOnce();

    expect(result.claimed).toBe(true);
    expect(result.stepId).toBe("plan");
    expect(result.status).toBe("completed");
    expect(store.getWorkflowStepRun("TASK-DIRECTOR-PLAN", "plan")?.status).toBe("completed");
    expect(store.getWorkflowStepRun("TASK-DIRECTOR-PLAN", "build")?.status).toBe("pending");
    expect(store.getTask("TASK-DIRECTOR-PLAN")?.status).toBe("running");
  });

  test("director executes review step and records approved verdict", async () => {
    const { store, vault, config } = await createRuntime();
    const workflowPlan = createDefaultWorkflowRegistry().plan(undefined, "implementation");

    store.createTask({
      id: "TASK-DIRECTOR-REVIEW",
      title: "Review feature",
      type: "implementation",
      assignedTo: "builder",
      obsidianPath: "01_Tasks/TASK-DIRECTOR-REVIEW.md",
      workflowPlan,
    });
    store.recordMessage({
      id: "MSG-DIRECTOR-REVIEW",
      discordMessageId: "discord-director-review",
      discordChannelId: "manual",
      taskId: "TASK-DIRECTOR-REVIEW",
      senderRole: "director",
      content: "Build and review the feature.",
    });
    store.completeWorkflowStepRun({
      taskId: "TASK-DIRECTOR-REVIEW",
      stepId: "plan",
      outputRef: "01_Tasks/TASK-DIRECTOR-REVIEW.md",
    });
    store.completeWorkflowStepRun({
      taskId: "TASK-DIRECTOR-REVIEW",
      stepId: "build",
      outputRef: "05_BuilderReports/TASK-DIRECTOR-REVIEW-build-builder-step.md",
    });

    const result = await new StepExecutor({
      role: "director",
      owner: "worker:director",
      store,
      vault,
      agent: directorAgent("VERDICT: APPROVED\nLooks good."),
      config,
    }).runOnce();

    expect(result.claimed).toBe(true);
    expect(result.stepId).toBe("review");
    expect(result.verdict).toBe("APPROVED");
    expect(store.getWorkflowStepRun("TASK-DIRECTOR-REVIEW", "review")?.status).toBe("completed");
    expect(store.getWorkflowStepRun("TASK-DIRECTOR-REVIEW", "arbitrate-if-blocked")?.status).toBe("skipped");
    expect(store.listTaskReviews("TASK-DIRECTOR-REVIEW")[0]?.verdict).toBe("APPROVED");
    expect(store.getTask("TASK-DIRECTOR-REVIEW")?.status).toBe("approved");
  });
});
