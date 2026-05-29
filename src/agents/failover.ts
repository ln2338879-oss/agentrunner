import { classifyProviderError, type ClassifiedProviderError } from "../providers/error-classifier";
import type { RuntimeIsolationPolicy } from "../safety/runtime-isolation";
import { runIsolatedCommand } from "../utils/isolated-command";
import type { ShellCommandResult } from "../utils/command";

export interface CommandCandidateResult {
  command: string;
  result: ShellCommandResult;
  classification?: ClassifiedProviderError;
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
  provider?: string;
  isolationPolicy?: RuntimeIsolationPolicy;
}): Promise<CommandCandidateResult> {
  const result = await runWithFailover({
    commands: input.enabled ? input.commands : input.commands.slice(0, 1),
    cwd: input.cwd,
    input: input.prompt,
    timeoutMs: input.timeoutMs,
    provider: input.provider,
    isolationPolicy: input.isolationPolicy,
  });
  return { command: result.command, result: result.result, classification: result.classification };
}

export async function runWithFailover(input: {
  commands: string[];
  cwd?: string;
  input?: string;
  timeoutMs?: number;
  provider?: string;
  isolationPolicy?: RuntimeIsolationPolicy;
}): Promise<CommandFailoverResult> {
  const attempts: CommandCandidateResult[] = [];
  const provider = input.provider ?? "CLI provider";

  for (const command of input.commands) {
    const result = await runIsolatedCommand({
      command,
      cwd: input.cwd,
      input: input.input,
      timeoutMs: input.timeoutMs,
      isolationPolicy: input.isolationPolicy,
    });
    const classification = result.ok ? undefined : classifyProviderError({
      provider,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: result.timedOut,
    });
    const candidate = { command, result, classification };
    attempts.push(candidate);
    if (result.ok) {
      return {
        ...candidate,
        attempts,
        ok: true,
        output: result.stdout || result.stderr,
      };
    }
    if (classification?.needsHuman) {
      return {
        ...candidate,
        attempts,
        ok: false,
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
    candidate.classification ? `error_kind: ${candidate.classification.kind}` : undefined,
    candidate.classification?.needsHuman ? "needs_human: true" : undefined,
    "",
  ].filter(Boolean).join("\n");
}
