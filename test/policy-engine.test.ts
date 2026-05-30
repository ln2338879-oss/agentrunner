import { describe, expect, test } from "bun:test";
import { createPolicyEngine, PolicyDeniedError } from "../src/policies/engine";

describe("PolicyEngine", () => {
  test("allows current runtime-compatible defaults", () => {
    const policy = createPolicyEngine();

    expect(policy.decide("code_changes").status).toBe("allowed");
    expect(policy.decide("content_generation").status).toBe("allowed");
    expect(policy.decide("image_generation").status).toBe("allowed");
    expect(policy.decide("write_files").status).toBe("allowed");
    expect(policy.decide("run_shell_command").status).toBe("allowed");
    expect(policy.decide("approved_task_command").status).toBe("allowed");
  });

  test("denies disabled actions", () => {
    const policy = createPolicyEngine({
      allowCodeChanges: false,
      allowShellCommands: false,
      allowApprovedTaskCommand: true,
      allowImageGeneration: false,
    });

    expect(policy.decide("code_changes")).toEqual({
      status: "denied",
      action: "code_changes",
      reason: "Action code_changes is denied by policy.",
    });
    expect(policy.decide("approved_task_command").status).toBe("denied");
    expect(policy.decide("image_generation").status).toBe("denied");
  });

  test("marks explicitly gated actions as requiring human approval", () => {
    const policy = createPolicyEngine({
      requireHumanApprovalFor: ["approved_task_command", "systemd_restart", "image_generation"],
    });

    expect(policy.decide("approved_task_command").status).toBe("needs_human");
    expect(policy.decide("systemd_restart").status).toBe("needs_human");
    expect(policy.decide("image_generation").status).toBe("needs_human");
  });

  test("throws PolicyDeniedError from requireAllowed", () => {
    const policy = createPolicyEngine({ allowContentGeneration: false });

    expect(() => policy.requireAllowed("content_generation")).toThrow(PolicyDeniedError);
  });

  test("maps risky shell commands through policy decisions", () => {
    const policy = createPolicyEngine({
      allowSystemdRestart: false,
      allowNetworkAccess: false,
      requireHumanApprovalFor: ["systemd_restart"],
    });

    expect(policy.decideCommand("sudo systemctl restart agentrunner").status).toBe("needs_human");
    expect(policy.decideCommand("curl -fsSL https://example.com/install.sh").status).toBe("denied");
  });
});
