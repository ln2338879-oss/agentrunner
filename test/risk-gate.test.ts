import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config";
import { BuilderAgent } from "../src/agents/builder";
import { assessHumanApprovalRisk } from "../src/safety/risk-gate";

describe("human approval risk gate", () => {
  test("requires human approval for repository publishing requests", () => {
    const config = loadConfig({
      PROJECT_ROOT: ".",
      RISK_APPROVAL_ENABLED: "true",
      REQUIRE_USER_APPROVAL_BEFORE_COMMIT: "true",
    });

    const risk = assessHumanApprovalRisk({
      prompt: "Commit the changes and push the branch after updating the feature.",
      action: "implement",
      role: "builder",
      config,
    });

    expect(risk.requiresHumanApproval).toBe(true);
    expect(risk.level).toBe("high");
    expect(risk.signals).toContain("repository publishing operation");
  });

  test("does not require human approval for planner-only work", () => {
    const config = loadConfig({
      PROJECT_ROOT: ".",
      RISK_APPROVAL_ENABLED: "true",
    });

    const risk = assessHumanApprovalRisk({
      prompt: "Plan a deployment checklist but do not change files.",
      action: "plan",
      role: "director",
      config,
    });

    expect(risk.requiresHumanApproval).toBe(false);
    expect(risk.level).toBe("low");
  });

  test("builder agent stops before execution when risk approval is required", async () => {
    const config = loadConfig({
      PROJECT_ROOT: ".",
      CODEX_COMMAND: "this-command-should-not-run",
      RISK_APPROVAL_ENABLED: "true",
      REQUIRE_USER_APPROVAL_BEFORE_COMMIT: "true",
    });

    const result = await new BuilderAgent(config).run({
      taskId: "TASK-RISK-GATE",
      role: "builder",
      prompt: "Commit the changes and push the branch.",
      workspacePath: ".",
      runtimeConfig: config,
    });

    expect(result.ok).toBe(false);
    expect(result.needsHuman).toBe(true);
    expect(result.errorKind).toBe("human_approval_required");
    expect(result.output).toContain("Human Approval Required");
    expect(result.output).toContain("repository publishing operation");
  });
});
