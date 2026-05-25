import type { RuntimeConfig } from "../config";
import type { AgentAdapter, AgentRunInput, AgentRunResult } from "../runtime/types";
import { buildCliPrompt } from "../utils/prompt";
import { runShellCommand } from "../utils/command";
import { formatFailoverHeader, parseCommandCandidates, runCommandWithFailover } from "./failover";

export class BuilderAgent implements AgentAdapter {
  readonly role = "builder" as const;

  constructor(private readonly config: RuntimeConfig) {}

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const config = input.runtimeConfig ?? this.config;
    const workspacePath = input.workspacePath ?? config.PROJECT_ROOT;
    const prompt = buildCliPrompt({
      role: "Builder",
      taskId: input.taskId,
      prompt: input.prompt,
      workspacePath,
    });

    const codexResult = await runCommandWithFailover({
      commands: parseCommandCandidates(config.CODEX_COMMAND, config.CODEX_COMMANDS),
      cwd: workspacePath,
      prompt,
      timeoutMs: config.AI_COMMAND_TIMEOUT_MS,
      enabled: config.ENABLE_AGENT_FAILOVER,
    });

    const validation = await this.runValidation(workspacePath, config);
    const output = [
      "# Builder Result",
      "",
      formatFailoverHeader(codexResult),
      "## Codex Output",
      codexResult.result.stdout || codexResult.result.stderr || "No Codex output.",
      "",
      validation,
    ].join("\n");

    return {
      ok: codexResult.result.ok && !validation.includes("VALIDATION_FAILED"),
      output,
      error: codexResult.result.ok ? extractValidationError(validation) : formatCliError(codexResult.result),
    };
  }

  private async runValidation(workspacePath: string, config: RuntimeConfig): Promise<string> {
    const sections: string[] = ["## Builder Validation"];

    if (config.BUILDER_DIFF_COMMAND) {
      sections.push(await runOptionalStep("Diff", config.BUILDER_DIFF_COMMAND, workspacePath));
    }

    if (config.BUILDER_TEST_COMMAND) {
      sections.push(await runOptionalStep("Test", config.BUILDER_TEST_COMMAND, workspacePath));
    }

    if (config.BUILDER_BUILD_COMMAND) {
      sections.push(await runOptionalStep("Build", config.BUILDER_BUILD_COMMAND, workspacePath));
    }

    return sections.join("\n\n");
  }
}

async function runOptionalStep(label: string, command: string, cwd: string): Promise<string> {
  const result = await runShellCommand({
    command,
    cwd,
    timeoutMs: 600000,
  });

  const status = result.ok ? "PASSED" : "VALIDATION_FAILED";
  const body = [
    `### ${label}: ${status}`,
    "",
    "```text",
    trimLongOutput(result.stdout || result.stderr || "No output."),
    "```",
  ].join("\n");

  return body;
}

function trimLongOutput(value: string, maxLength = 12000): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}\n... [truncated]`;
}

function extractValidationError(validation: string): string | undefined {
  return validation.includes("VALIDATION_FAILED") ? "Builder validation failed. See Builder report for details." : undefined;
}

function formatCliError(result: { exitCode: number | null; stderr: string; timedOut: boolean }): string {
  if (result.timedOut) return "Codex command timed out.";
  return `Codex command failed with exit code ${result.exitCode}.\n${result.stderr}`;
}
