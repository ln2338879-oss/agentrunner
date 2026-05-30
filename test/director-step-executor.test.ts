import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config";
import { RuntimeStore } from "../src/db/runtime-store";
import { VaultManager } from "../src/obsidian/vault-manager";
import type { AgentAdapter, AgentRunInput, AgentRunResult } from "../src/runtime/types";
import { createDefaultWorkflowRegistry } from "../src/workflows/engine";
import { StepExecutor, claimRoleIdsForAgentRole } from "../src/workflows/step-executor";

const tempDirs: string[] = [];
const stores: RuntimeStore[] = [];

async function createRuntime() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agentrunner-director-step-"));
  tempDirs.push(dir);
  const store = await RuntimeStore.open(path.join(dir, "runtime.sqlite"));
  stores.push(store);
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
  for (const store of stores) store.close();
  await Promise.allSettled(tempDirs.map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })));
});

function directorAgent(output: string, ok = true): AgentAdapter {
  return {
    role: "director",
    async run(_input: AgentRunInput): Promise<AgentRunResult> {
      return ok ? { ok: true, output } : { ok: false, output, error: "mock failed" };
    },
  };
}

function recordingAgent(input: { role: "director" | "builder"; output: string; prompts: string[] }): AgentAdapter {
  return {
    role: input.role,
    async run(runInput: AgentRunInput): Promise<AgentRunResult> {
      input.prompts.push(runInput.prompt);
      return { ok: true, output: input.output };
    },
  };
}

function mutatingDirectorAgent(input: { filePath: string; output: string }): AgentAdapter {
  return {
    role: "director",
    async run(_input: AgentRunInput): Promise<AgentRunResult> {
      await writeFile(input.filePath, "changed by reviewer\n", "utf-8");
      return { ok: true, output: input.output };
    },
  };
}

async function createImplementationTask(store: RuntimeStore, taskId: string) {
  const workflowPlan = createDefaultWorkflowRegistry().plan(undefined, "implementation");
  store.createTask({
    id: taskId,
    title: "Review feature",
    type: "implementation",
    assignedTo: "builder",
    obsidianPath: `01_Tasks/${taskId}.md`,
    workflowPlan,
  });
  store.recordMessage({
    id: `MSG-${taskId}`,
    discordMessageId: `discord-${taskId}`,
    discordChannelId: "manual",
    taskId,
    senderRole: "director",
    content: "Build and review the feature.",
  });
}

function completePlanAndBuild(store: RuntimeStore, taskId: string): void {
  store.completeWorkflowStepRun({
    taskId,
    stepId: "plan",
    outputRef: `01_Tasks/${taskId}.md`,
  });
  store.completeWorkflowStepRun({
    taskId,
    stepId: "build",
    outputRef: `05_BuilderReports/${taskId}-build-builder-step.md`,
  });
}

function git(dir: string, command: string): void {
  const shell = process.platform === "win32" ? [process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe", "/d", "/s", "/c", command] : ["sh", "-lc", command];
  const result = Bun.spawnSync(shell, { cwd: dir });
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr));
  }
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
    await createImplementationTask(store, "TASK-DIRECTOR-REVIEW");
    completePlanAndBuild(store, "TASK-DIRECTOR-REVIEW");

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

  test("review prompt includes safety contract and diff context", async () => {
    const { store, vault, config } = await createRuntime();
    await createImplementationTask(store, "TASK-REVIEW-SAFETY-CONTEXT");
    completePlanAndBuild(store, "TASK-REVIEW-SAFETY-CONTEXT");
    const prompts: string[] = [];

    const result = await new StepExecutor({
      role: "director",
      owner: "worker:director",
      store,
      vault,
      agent: recordingAgent({ role: "director", output: "VERDICT: APPROVED\nLooks good.", prompts }),
      config,
    }).runOnce();

    expect(result.verdict).toBe("APPROVED");
    expect(prompts[0]).toContain("## Review Safety Contract");
    expect(prompts[0]).toContain("## Workspace Diff / Static Review Context");
  });

  test("needs revision requeues build and review steps", async () => {
    const { store, vault, config } = await createRuntime();
    await createImplementationTask(store, "TASK-REVISION-REQUEUE");
    completePlanAndBuild(store, "TASK-REVISION-REQUEUE");

    const result = await new StepExecutor({
      role: "director",
      owner: "worker:director",
      store,
      vault,
      agent: directorAgent("VERDICT: NEEDS_REVISION\nFix the failing tests and rerun validation."),
      config,
    }).runOnce();

    expect(result.verdict).toBe("NEEDS_REVISION");
    expect(store.getWorkflowStepRun("TASK-REVISION-REQUEUE", "build")?.status).toBe("pending");
    expect(store.getWorkflowStepRun("TASK-REVISION-REQUEUE", "review")?.status).toBe("pending");
    expect(store.getTask("TASK-REVISION-REQUEUE")?.status).toBe("needs_revision");
    expect(store.listTaskReviews("TASK-REVISION-REQUEUE")[0]?.verdict).toBe("NEEDS_REVISION");
  });

  test("retry with different agent verdict escalates to human instead of switching agents", async () => {
    const { store, vault, config } = await createRuntime();
    await createImplementationTask(store, "TASK-RETRY-HUMAN");
    completePlanAndBuild(store, "TASK-RETRY-HUMAN");

    const result = await new StepExecutor({
      role: "director",
      owner: "worker:director",
      store,
      vault,
      agent: directorAgent("VERDICT: RETRY_WITH_DIFFERENT_AGENT\nA different provider would be better for this task."),
      config,
    }).runOnce();

    expect(result.verdict).toBe("RETRY_WITH_DIFFERENT_AGENT");
    expect(store.getTask("TASK-RETRY-HUMAN")?.status).toBe("needs_human");
    expect(store.listTaskArtifacts("TASK-RETRY-HUMAN").some((artifact) => artifact.type === "human_intervention")).toBe(true);
  });

  test("split task verdict creates child planning tasks", async () => {
    const { store, vault, config } = await createRuntime();
    await createImplementationTask(store, "TASK-SPLIT-ACTION");
    completePlanAndBuild(store, "TASK-SPLIT-ACTION");

    const result = await new StepExecutor({
      role: "director",
      owner: "worker:director",
      store,
      vault,
      agent: directorAgent([
        "VERDICT: SPLIT_TASK",
        "- Implement the combat controller and add tests.",
        "- Generate monster stat CSV tables.",
      ].join("\n")),
      config,
    }).runOnce();

    expect(result.verdict).toBe("SPLIT_TASK");
    expect(store.getTask("TASK-SPLIT-ACTION")?.status).toBe("split_task");
    const recent = store.listRecentTasks(10);
    const children = recent.filter((task) => task.id.startsWith("TASK-") && task.id !== "TASK-SPLIT-ACTION" && task.assignedTo === "director");
    expect(children.length).toBeGreaterThanOrEqual(2);
    expect(store.listTaskArtifacts("TASK-SPLIT-ACTION").some((artifact) => artifact.type === "split_task_plan")).toBe(true);
  });

  test("requeued builder prompt includes prior review feedback", async () => {
    const { store, vault, config } = await createRuntime();
    await createImplementationTask(store, "TASK-REVISION-FEEDBACK");
    completePlanAndBuild(store, "TASK-REVISION-FEEDBACK");

    await new StepExecutor({
      role: "director",
      owner: "worker:director",
      store,
      vault,
      agent: directorAgent("VERDICT: NEEDS_REVISION\nFix the failing tests and rerun validation."),
      config,
    }).runOnce();

    const prompts: string[] = [];
    const result = await new StepExecutor({
      role: "builder",
      owner: "worker:builder",
      store,
      vault,
      agent: recordingAgent({ role: "builder", output: "Builder fixed the tests.", prompts }),
      config,
    }).runOnce();

    expect(result.stepId).toBe("build");
    expect(prompts[0]).toContain("## Prior Review Feedback");
    expect(prompts[0]).toContain("Fix the failing tests and rerun validation.");
    expect(prompts[0]).toContain("Current Step Requeue Reason");
  });

  test("review read-only guard fails if reviewer mutates workspace", async () => {
    const { dir, store, vault, config } = await createRuntime();
    await writeFile(path.join(dir, "tracked.txt"), "original\n", "utf-8");
    git(dir, "git init && git config user.email test@example.com && git config user.name Test && git add tracked.txt && git commit -m initial");
    await createImplementationTask(store, "TASK-READ-ONLY-GUARD");
    completePlanAndBuild(store, "TASK-READ-ONLY-GUARD");

    const result = await new StepExecutor({
      role: "director",
      owner: "worker:director",
      store,
      vault,
      agent: mutatingDirectorAgent({
        filePath: path.join(dir, "tracked.txt"),
        output: "VERDICT: APPROVED\nLooks good.",
      }),
      config,
    }).runOnce();

    expect(result.status).toBe("failed");
    expect(result.error).toContain("read-only guard");
    expect(result.output).toContain("READ_ONLY_VIOLATION");
    expect(store.getWorkflowStepRun("TASK-READ-ONLY-GUARD", "review")?.status).toBe("failed");
    expect(store.getTask("TASK-READ-ONLY-GUARD")?.status).toBe("failed");
  });
});
