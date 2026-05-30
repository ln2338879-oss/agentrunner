import { describe, expect, test } from "bun:test";
import path from "node:path";
import { loadConfig } from "../src/config";
import type { AgentAdapter, AgentRunInput, AgentRunResult } from "../src/runtime/types";
import { withTaskWorkspaceIsolation } from "../src/safety/workspace-agent";

describe("task workspace agent wrapper", () => {
  test("passes project root workspace when task workspace isolation is disabled", async () => {
    const config = loadConfig({
      PROJECT_ROOT: "/tmp/agentrunner-project",
      TASK_WORKTREE_ISOLATION_ENABLED: false,
    } as unknown as NodeJS.ProcessEnv);
    let captured: AgentRunInput | undefined;
    const base: AgentAdapter = {
      role: "builder",
      async run(input: AgentRunInput): Promise<AgentRunResult> {
        captured = input;
        return { ok: true, output: "ok" };
      },
    };

    const result = await withTaskWorkspaceIsolation(base, config).run({
      taskId: "TASK-WORKSPACE",
      role: "builder",
      prompt: "Implement a small change.",
    });

    expect(result.ok).toBe(true);
    expect(captured?.workspacePath).toBe(path.resolve(config.PROJECT_ROOT));
    expect(captured?.prompt).toContain("Runtime Workspace");
    expect(captured?.prompt).toContain("workspace_mode: project-root");
  });
});
