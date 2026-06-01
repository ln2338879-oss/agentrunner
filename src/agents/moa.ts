import type { RuntimeConfig } from "../config";
import { classifyProviderError } from "../providers/error-classifier";
import type { RuntimeIsolationPolicy } from "../safety/runtime-isolation";
import { runIsolatedCommand } from "../utils/isolated-command";

export interface MoaOpinion {
  command: string;
  ok: boolean;
  exitCode: number | null;
  timedOut: boolean;
  errorKind?: string;
  output: string;
}

export async function buildMoaContext(input: {
  config: RuntimeConfig;
  prompt: string;
  workspacePath: string;
  isolationPolicy?: RuntimeIsolationPolicy;
}): Promise<string> {
  if (!input.config.MOA_ENABLED || !shouldUseMoaForPrompt(input.prompt)) return "";

  const commands = parseMoaCommands(input.config.MOA_MODEL_COMMANDS);
  if (commands.length === 0) return "";

  const opinions: MoaOpinion[] = [];
  for (const command of commands) {
    const result = await runIsolatedCommand({
      command,
      cwd: input.workspacePath,
      input: buildMoaPrompt(input.prompt),
      timeoutMs: input.config.MOA_COMMAND_TIMEOUT_MS,
      isolationPolicy: input.isolationPolicy,
    });
    const classification = result.ok
      ? undefined
      : classifyProviderError({
          provider: `MoA provider (${command})`,
          stdout: result.stdout,
          stderr: result.stderr,
          timedOut: result.timedOut,
        });

    opinions.push({
      command,
      ok: result.ok,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      errorKind: classification?.kind,
      output: result.stdout || result.stderr || classification?.reason || "No output.",
    });
  }

  return formatMoaContext(opinions);
}

export function shouldUseMoaForPrompt(prompt: string): boolean {
  return [
    /# AgentRunner Review Step/i,
    /# AgentRunner Arbitration Step/i,
    /^Action:\s*(review|arbitrate)\s*$/im,
    /You must start with exactly one verdict line/i,
  ].some((pattern) => pattern.test(prompt));
}

export function parseMoaCommands(value: string): string[] {
  return [...new Set(value.split("||").map((command) => command.trim()).filter(Boolean))];
}

function buildMoaPrompt(prompt: string): string {
  return [
    "You are an external model in AgentRunner's Mixture-of-Agents review panel.",
    "Give concise, critical feedback for the reviewer or arbiter.",
    "Do not modify files or run write operations.",
    "Do not produce the final AgentRunner verdict; provide advisory observations only.",
    "Focus on correctness, missing tests, safety risks, and concrete revision advice.",
    "",
    "## Review Input",
    prompt,
  ].join("\n");
}

function formatMoaContext(opinions: MoaOpinion[]): string {
  const sections = opinions.map((opinion, index) => [
    `### Opinion ${index + 1}`,
    "",
    `command: ${opinion.command}`,
    `ok: ${opinion.ok}`,
    `exit_code: ${opinion.exitCode ?? "null"}`,
    `timed_out: ${opinion.timedOut}`,
    opinion.errorKind ? `error_kind: ${opinion.errorKind}` : undefined,
    "",
    "```text",
    trimLongOutput(opinion.output),
    "```",
  ].filter(Boolean).join("\n"));

  return [
    "## External Model Opinions (MoA)",
    "",
    "These opinions are advisory context. The Director still owns the final verdict.",
    "Use them to catch missed issues, compare alternatives, and reduce single-model blind spots.",
    "",
    ...sections,
  ].join("\n\n");
}

function trimLongOutput(value: string, maxLength = 6000): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}\n... [truncated]`;
}
