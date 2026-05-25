import { runShellCommand, type ShellCommandResult } from "../utils/command";

export interface CommandCandidateResult {
  command: string;
  result: ShellCommandResult;
}

export interface CommandFailoverResult extends CommandCandidateResult {
  attempts: CommandCandidateResult[];
  ok: boolean;
  output: string;
}

export function parseCommandCandidates(primary: string, alternates: string): string[] {
  const values = [primary, ...alternates.split("||")]
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(values)];
}

export async function runCommandWithFailover(input: {
  commands: string[];
  cwd: string;
  prompt: string;
  timeoutMs: number;
  enabled: boolean;
}): Promise<CommandCandidateResult> {
  const result = await runWithFailover({
    commands: input.enabled ? input.commands : input.commands.slice(0, 1),
    cwd: input.cwd,
    input: input.prompt,
    timeoutMs: input.timeoutMs,
  });
  return { command: result.command, result: result.result };
}

export async function runWithFailover(input: {
  commands: string[];
  cwd?: string;
  input?: string;
  timeoutMs?: number;
}): Promise<CommandFailoverResult> {
  const attempts: CommandCandidateResult[] = [];

  for (const command of input.commands) {
    const result = await runShellCommand({
      command,
      cwd: input.cwd,
      input: input.input,
      timeoutMs: input.timeoutMs,
    });
    const candidate = { command, result };
    attempts.push(candidate);
    if (result.ok) {
      return {
        ...candidate,
        attempts,
        ok: true,
        output: result.stdout || result.stderr,
      };
    }
  }

  const last = attempts.at(-1);
  if (!last) throw new Error("No command candidates configured.");

  return {
    ...last,
    attempts,
    ok: false,
    output: last.result.stdout || last.result.stderr,
  };
}

export function formatFailoverHeader(candidate: CommandCandidateResult): string {
  return [
    "# Agent Execution",
    "",
    `command: ${candidate.command}`,
    `ok: ${candidate.result.ok}`,
    `exit_code: ${candidate.result.exitCode ?? "null"}`,
    `timed_out: ${candidate.result.timedOut}`,
    "",
  ].join("\n");
}
