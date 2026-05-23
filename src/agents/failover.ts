import { runShellCommand, type ShellCommandResult } from "../utils/command";

export interface CommandCandidateResult {
  command: string;
  result: ShellCommandResult;
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
  const commands = input.enabled ? input.commands : input.commands.slice(0, 1);
  let last: CommandCandidateResult | null = null;

  for (const command of commands) {
    const result = await runShellCommand({
      command,
      cwd: input.cwd,
      input: input.prompt,
      timeoutMs: input.timeoutMs,
    });
    last = { command, result };
    if (result.ok) return last;
  }

  if (!last) throw new Error("No command candidates configured.");
  return last;
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
