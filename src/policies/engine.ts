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

  decideCommand(command: string, input: { baseAction?: PolicyAction } = {}): PolicyDecision {
    const baseAction = input.baseAction ?? "run_shell_command";
    const decisions = uniqueActions([baseAction, ...actionsForCommand(command)]).map((action) => this.decide(action));
    const needsHuman = decisions.find((decision) => decision.status === "needs_human");
    if (needsHuman) return needsHuman;

    const denied = decisions.find((decision) => decision.status === "denied");
    if (denied) return denied;

    return {
      status: "allowed",
      action: baseAction,
      reason: "Command is allowed by policy.",
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

function actionsForCommand(command: string): PolicyAction[] {
  const normalized = command.toLowerCase();
  const actions: PolicyAction[] = [];

  if (/\bsystemctl\s+(restart|reload|start|stop|enable|disable|daemon-reload)\b/.test(normalized)) {
    actions.push("systemd_restart");
  }

  if (/\b(curl|wget|invoke-webrequest|iwr)\b/.test(normalized) || /https?:\/\//.test(normalized)) {
    actions.push("network_access");
  }

  return actions;
}

function uniqueActions(actions: PolicyAction[]): PolicyAction[] {
  return [...new Set(actions)];
}
