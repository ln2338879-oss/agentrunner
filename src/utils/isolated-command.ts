import { assessRuntimeIsolation, formatRuntimeIsolationViolation, type RuntimeIsolationPolicy } from "../safety/runtime-isolation";
import { runShellCommand, type RunShellCommandOptions, type ShellCommandResult } from "./command";

export interface RunIsolatedCommandOptions extends RunShellCommandOptions {
  isolationPolicy?: RuntimeIsolationPolicy;
}

export async function runIsolatedCommand(options: RunIsolatedCommandOptions): Promise<ShellCommandResult> {
  const decision = assessRuntimeIsolation({
    command: options.command,
    cwd: options.cwd,
    policy: options.isolationPolicy,
  });

  if (!decision.ok) {
    return {
      ok: false,
      exitCode: null,
      stdout: formatRuntimeIsolationViolation(decision),
      stderr: decision.reason ?? "Command blocked by runtime isolation policy.",
      timedOut: false,
    };
  }

  return runShellCommand(options);
}
