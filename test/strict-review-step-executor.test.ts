import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
  const dir = await mkdtemp(path.join(os.tmpdir(), "agentrunner-strict-review-step-"));
  tempDirs.push(dir);
  const store = await RuntimeStore.open(path.join(dir, "runtime.sqlite"));
  const vault = new VaultManager(path.join(dir, "vault"));
  await vault.ensureDefaultFolders();
  const config = loadConfig({
    DATABASE_PATH: path.join(dir, "runtime.sqlite"),
    OBSIDIAN_VAULT_PATH: path.join(dir, "vault"),
    PROJECT_ROOT: dir,
    CLAUDE_CODE_COMMAND: "mock-claude",
    STRICT_REVIEW_ENABLED: "true",
    STRICT_REVIEW_REQUIRE_TESTS: "true",
    STRICT_REVIEW_COMMANDS: "",
    STRICT_REVIEW_FAIL_ON_VALIDATION_ERROR: "true",
  });
  return { dir, store, vault, config };
}

afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

function directorAgent(output: string): AgentAdapter {
  return {
    role: "director",
    async run(_input: AgentRunInput): Promise<AgentRunResult> {
      return { ok: true, output };
    },
  };
}

function git(dir: string, command: string): void {
  const result = Bun.spawnSync(["sh", "-lc", command], { cwd: dir });
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
}

async function createImplementationTask(store: RuntimeStore, taskId: string): Promise<void> {
  const workflowPlan = createDefaultWorkflowRegistry().plan(undefined, "implementation");
  store.createTask({
    id: taskId,
    title: "Review strict gate feature",
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

describe("strict review step executor integration", () => {
  test("downgrades reviewer approval to needs revision when code changes lack tests", async () => {
    const { dir, store, vault, config } = await createRuntime();
    await writeFile(path.join(dir, "README.md"), "# temp project\n", "utf-8");
    git(dir, "git init && git config user.email test@example.com && git config user.name Test && git add README.md && git commit -m initial");
    await mkdir(path.join(dir, "src"), { recursive: true });
    await writeFile(path.join(dir, "src", "feature.ts"), "export const value = 1;\n", "utf-8");

    await createImplementationTask(store, "TASK-STRICT-GATE");
    completePlanAndBuild(store, "TASK-STRICT-GATE");

    const result = await new StepExecutor({
      role: "director",
      owner: "worker:director",
      store,
      vault,
      agent: directorAgent("VERDICT: APPROVED\nLooks good."),
      config,
    }).runOnce();

    expect(result.status).toBe("completed");
    expect(result.verdict).toBe("NEEDS_REVISION");
    expect(result.output).toContain("Strict Review Gate Override");
    expect(result.output).toContain("Code files changed but no test/spec files changed");
    expect(store.listTaskReviews("TASK-STRICT-GATE")[0]?.verdict).toBe("NEEDS_REVISION");
    expect(store.getWorkflowStepRun("TASK-STRICT-GATE", "build")?.status).toBe("pending");
    expect(store.getWorkflowStepRun("TASK-STRICT-GATE", "review")?.status).toBe("pending");
    expect(store.getTask("TASK-STRICT-GATE")?.status).toBe("needs_revision");
  });
});
