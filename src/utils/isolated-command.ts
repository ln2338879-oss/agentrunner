import { buildGitPathGuardEnv } from "../safety/git-path-guard";
import { assessRuntimeIsolation, formatRuntimeIsolationViolation, type RuntimeIsolationPolicy } from "../safety/runtime-isolation";
import { parseCommandLine, runCommand, splitCommandSequence, type RunShellCommandOptions, type ShellCommandResult } from "./command";

export interface RunIsolatedCommandOptions extends RunShellCommandOptions {
  isolationPolicy?: RuntimeIsolationPolicy;
}

export async function runIsolatedCommand(options: RunIsolatedCommandOptions): Promise<ShellCommandResult> {
  const parsed = parseCommandLine(options.command);
  if (!parsed.ok) {
    const sequence = splitCommandSequence(options.command);
    if (sequence.ok && sequence.commands.length > 1) return runIsolatedCommandSequence(options);
    return blocked(parsed.error);
  }

  const decision = assessRuntimeIsolation({
    command: options.command,
    argv: parsed.parsed.argv,
    cwd: options.cwd,
    policy: options.isolationPolicy,
  });

  if (!decision.ok) return isolationBlocked(decision);

  const env = await isolatedCommandEnv(options);

  return runCommand({
    argv: parsed.parsed.argv,
    cwd: options.cwd,
    input: options.input,
    timeoutMs: options.timeoutMs,
    env,
  });
}

export async function runIsolatedCommandSequence(options: RunIsolatedCommandOptions): Promise<ShellCommandResult> {
  const commands = splitCommandSequence(options.command);
  if (!commands.ok) return blocked(commands.error);

  const stdoutParts: string[] = [];
  const stderrParts: string[] = [];
  let lastExitCode: number | null = 0;
  let timedOut = false;

  for (const command of commands.commands) {
    const result = await runIsolatedCommand({ ...options, command });
    stdoutParts.push(result.stdout);
    stderrParts.push(result.stderr);
    lastExitCode = result.exitCode;
    timedOut = timedOut || result.timedOut;
    if (!result.ok) {
      return {
        ok: false,
        exitCode: result.exitCode,
        stdout: stdoutParts.join(""),
        stderr: stderrParts.join(""),
        timedOut,
      };
    }
  }

  return {
    ok: true,
    exitCode: lastExitCode,
    stdout: stdoutParts.join(""),
    stderr: stderrParts.join(""),
    timedOut,
  };
}

async function isolatedCommandEnv(options: RunIsolatedCommandOptions): Promise<NodeJS.ProcessEnv | undefined> {
  if (options.isolationPolicy?.mode !== "readonly") return options.env;
  return await buildGitPathGuardEnv({
    projectRoot: options.isolationPolicy.projectRoot,
    env: options.env,
  });
}

function isolationBlocked(decision: ReturnType<typeof assessRuntimeIsolation>): ShellCommandResult {
  return {
    ok: false,
    exitCode: null,
    stdout: formatRuntimeIsolationViolation(decision),
    stderr: decision.reason ?? "Command blocked by runtime isolation policy.",
    timedOut: false,
  };
}

function blocked(message: string): ShellCommandResult {
  return {
    ok: false,
    exitCode: null,
    stdout: "# Runtime Isolation Blocked Command\n\nCommand could not be parsed as a simple argv invocation.",
    stderr: message,
    timedOut: false,
  };
}
