import { DefaultRuntimePolicy, type PolicyAction, type PolicyDecision, type RuntimePolicy } from "./types";

export class PolicyEngine {
  constructor(private readonly policy: RuntimePolicy = DefaultRuntimePolicy) {}

  decide(action: PolicyAction): PolicyDecision {
    if (this.policy.requireHumanApprovalFor.includes(action)) {
      return {
        status: "needs_human",
        action,
        reason: `Action ${action} requires human approval by policy.`,
      };
    }

    if (!this.isAllowed(action)) {
      return {
        status: "denied",
        action,
        reason: `Action ${action} is denied by policy.`,
      };
    }

    return {
      status: "allowed",
      action,
      reason: `Action ${action} is allowed by policy.`,
    };
  }

  requireAllowed(action: PolicyAction): void {
    const decision = this.decide(action);
    if (decision.status !== "allowed") {
      throw new PolicyDeniedError(decision);
    }
  }

  private isAllowed(action: PolicyAction): boolean {
    if (action === "code_changes") return this.policy.allowCodeChanges;
    if (action === "content_generation") return this.policy.allowContentGeneration;
    if (action === "write_files") return this.policy.allowFileWrites;
    if (action === "run_shell_command") return this.policy.allowShellCommands;
    if (action === "run_tests") return this.policy.allowTests && this.policy.allowShellCommands;
    if (action === "run_build") return this.policy.allowBuilds && this.policy.allowShellCommands;
    if (action === "approved_task_command") return this.policy.allowApprovedTaskCommand && this.policy.allowShellCommands;
    if (action === "systemd_restart") return this.policy.allowSystemdRestart && this.policy.allowShellCommands;
    if (action === "network_access") return this.policy.allowNetworkAccess;
    return false;
  }
}

export class PolicyDeniedError extends Error {
  constructor(readonly decision: PolicyDecision) {
    super(decision.reason);
    this.name = "PolicyDeniedError";
  }
}

export function createPolicyEngine(policy?: Partial<RuntimePolicy>): PolicyEngine {
  return new PolicyEngine({ ...DefaultRuntimePolicy, ...(policy ?? {}) });
}
