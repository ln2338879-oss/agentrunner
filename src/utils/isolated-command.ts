import { assessRuntimeIsolation, formatRuntimeIsolationViolation, type RuntimeIsolationPolicy } from "../safety/runtime-isolation";
import { parseCommandLine, runCommand, type RunShellCommandOptions, type ShellCommandResult } from "./command";

export interface RunIsolatedCommandOptions extends RunShellCommandOptions {
  isolationPolicy?: RuntimeIsolationPolicy;
}

export async function runIsolatedCommand(options: RunIsolatedCommandOptions): Promise<ShellCommandResult> {
  const parsed = parseCommandLine(options.command);
  if (!parsed.ok) {
    return {
      ok: false,
      exitCode: null,
      stdout: "# Runtime Isolation Blocked Command\n\nCommand could not be parsed as a simple argv invocation.",
      stderr: parsed.error,
      timedOut: false,
    };
  }

  const decision = assessRuntimeIsolation({
    command: options.command,
    argv: parsed.parsed.argv,
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

  return runCommand({
    argv: parsed.parsed.argv,
    cwd: options.cwd,
    input: options.input,
    timeoutMs: options.timeoutMs,
    env: options.env,
  });
}
