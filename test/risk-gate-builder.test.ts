import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BuilderAgent } from "../src/agents/builder";
import { loadConfig } from "../src/config";
import { assessHumanApprovalRisk } from "../src/safety/risk-gate";

describe("human approval risk gate", () => {
  test("detects dependency changes as high risk", () => {
    const config = loadConfig({
      PROJECT_ROOT: ".",
      CODEX_COMMAND: "mock-codex",
      RISK_APPROVAL_ENABLED: "true",
      RISK_APPROVAL_REQUIRE_FOR_DEPENDENCY_CHANGES: "true",
    });

    const assessment = assessHumanApprovalRisk({
      prompt: "Update package.json to add a new runtime dependency.",
      action: "implement",
      role: "builder",
      config,
    });

    expect(assessment.requiresHumanApproval).toBe(true);
    expect(assessment.level).toBe("high");
    expect(assessment.signals).toContain("dependency or lockfile change");
  });

  test("builder stops before provider execution for risky dependency work", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "agentrunner-risk-gate-builder-"));
    try {
      const config = loadConfig({
        PROJECT_ROOT: dir,
        CODEX_COMMAND: "command-that-should-not-run",
        CODEX_COMMANDS: "",
        RISK_APPROVAL_ENABLED: "true",
        RISK_APPROVAL_REQUIRE_FOR_DEPENDENCY_CHANGES: "true",
      });

      const result = await new BuilderAgent(config).run({
        taskId: "TASK-RISK-BUILDER",
        role: "builder",
        prompt: "Update package.json and the lockfile for a new dependency.",
        workspacePath: dir,
      });

      expect(result.ok).toBe(false);
      expect(result.needsHuman).toBe(true);
      expect(result.errorKind).toBe("human_approval_required");
      expect(result.output).toContain("Human Approval Required");
      expect(result.output).toContain("dependency or lockfile change");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
