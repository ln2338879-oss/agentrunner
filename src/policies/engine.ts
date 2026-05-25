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
    const permissions: Record<PolicyAction, boolean> = {
      code_changes: this.policy.allowCodeChanges,
      content_generation: this.policy.allowContentGeneration,
      image_generation: this.policy.allowImageGeneration && this.policy.allowFileWrites,
      write_files: this.policy.allowFileWrites,
      run_shell_command: this.policy.allowShellCommands,
      run_tests: this.policy.allowTests && this.policy.allowShellCommands,
      run_build: this.policy.allowBuilds && this.policy.allowShellCommands,
      approved_task_command: this.policy.allowApprovedTaskCommand && this.policy.allowShellCommands,
      systemd_restart: this.policy.allowSystemdRestart && this.policy.allowShellCommands,
      network_access: this.policy.allowNetworkAccess,
    };
    return permissions[action] ?? false;
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
