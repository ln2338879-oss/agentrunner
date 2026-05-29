import path from "node:path";
import type { AgentRole } from "../runtime/types";

export type RuntimeIsolationMode = "readonly" | "workspace-write";

export interface RuntimeIsolationPolicy {
  role: AgentRole;
  mode: RuntimeIsolationMode;
  projectRoot: string;
  action?: string;
}

export interface RuntimeIsolationDecision {
  ok: boolean;
  reason?: string;
  signals: string[];
}

export function assessRuntimeIsolation(input: {
  command: string;
  cwd?: string;
  policy?: RuntimeIsolationPolicy;
}): RuntimeIsolationDecision {
  if (!input.policy) return { ok: true, signals: [] };

  const signals: string[] = [];
  const cwdDecision = assessWorkingDirectory({
    cwd: input.cwd,
    projectRoot: input.policy.projectRoot,
  });
  signals.push(...cwdDecision.signals);
  if (!cwdDecision.ok) return cwdDecision;

  const commandDecision = assessCommandShape({
    command: input.command,
    policy: input.policy,
  });
  signals.push(...commandDecision.signals);
  if (!commandDecision.ok) return { ...commandDecision, signals };

  return { ok: true, signals };
}

export function formatRuntimeIsolationViolation(decision: RuntimeIsolationDecision): string {
  return [
    "# Runtime Isolation Blocked Command",
    "",
    decision.reason ?? "The command was blocked by AgentRunner runtime isolation policy.",
    "",
    "## Signals",
    decision.signals.length > 0 ? decision.signals.map((signal) => `- ${signal}`).join("\n") : "No signals recorded.",
  ].join("\n");
}

function assessWorkingDirectory(input: { cwd?: string; projectRoot: string }): RuntimeIsolationDecision {
  const projectRoot = path.resolve(input.projectRoot);
  const cwd = path.resolve(input.cwd ?? projectRoot);
  if (!isSameOrInside(cwd, projectRoot)) {
    return {
      ok: false,
      reason: "Command working directory is outside PROJECT_ROOT.",
      signals: [`cwd=${cwd}`, `projectRoot=${projectRoot}`],
    };
  }
  return { ok: true, signals: [`cwd_inside_project=${cwd}`] };
}

function assessCommandShape(input: { command: string; policy: RuntimeIsolationPolicy }): RuntimeIsolationDecision {
  const command = input.command.trim();
  if (!command) {
    return { ok: false, reason: "Empty command is not allowed.", signals: ["empty_command"] };
  }

  const writeSignals = writeOperationSignals(command);
  if (input.policy.mode === "readonly" && writeSignals.length > 0) {
    return {
      ok: false,
      reason: "Read-only runtime cannot run commands that look like workspace write or publish operations.",
      signals: writeSignals,
    };
  }

  const shellRiskSignals = shellRiskSignalsFor(command).filter(
    (signal) => !(input.policy.action === "validate" && signal === "compound shell expression"),
  );
  if (shellRiskSignals.length > 0) {
    return {
      ok: false,
      reason: "Command shape is too broad for the runtime isolation boundary. Use a simple configured tool command instead.",
      signals: shellRiskSignals,
    };
  }

  return { ok: true, signals: [] };
}

function writeOperationSignals(command: string): string[] {
  const checks: Array<[RegExp, string]> = [
    [/\bgit\s+(commit|push|merge|rebase|tag|reset|checkout|switch|branch)\b/i, "git write or publish operation"],
    [/\b(commit|push|merge|release|deploy|publish)\b/i, "publish/deploy keyword"],
    [/\b(npm|pnpm|yarn|bun)\s+(install|add|update|remove)\b/i, "dependency mutation command"],
    [/\b(package\.json|bun\.lockb?|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)\b/i, "package or lockfile target"],
    [/(^|\s)>\s*[^\s]/, "shell output redirection"],
    [/(^|\s)>>\s*[^\s]/, "shell append redirection"],
    [/\b(sed|perl)\b(?=[^;&|]*\s-i(?:\s|$))/i, "in-place file mutation command"],
    [/\btee\s+(?:-[a-zA-Z]+\s+)*[^\s|;&]+/i, "in-place file mutation command"],
  ];
  return checks.filter(([pattern]) => pattern.test(command)).map(([, signal]) => signal);
}

function shellRiskSignalsFor(command: string): string[] {
  const checks: Array<[RegExp, string]> = [
    [/\s&&\s|\s\|\|\s|;|`|\$\(/, "compound shell expression"],
    [/\b(eval|source)\b/i, "dynamic shell execution"],
  ];
  return checks.filter(([pattern]) => pattern.test(command)).map(([, signal]) => signal);
}

function isSameOrInside(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
