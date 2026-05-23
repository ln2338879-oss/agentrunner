import type { RuntimeConfig } from "../config";
import type { AgentAdapter, AgentRunInput, AgentRunResult } from "../runtime/types";
import { buildCliPrompt } from "../utils/prompt";
import { runShellCommand } from "../utils/command";

export class BuilderAgent implements AgentAdapter {
  readonly role = "builder" as const;

  constructor(private readonly config: RuntimeConfig) {}

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const workspacePath = input.workspacePath ?? this.config.PROJECT_ROOT;
    const prompt = buildCliPrompt({
      role: "Builder",
      taskId: input.taskId,
      prompt: input.prompt,
      workspacePath,
    });

    const codexResult = await runShellCommand({
      command: this.config.CODEX_COMMAND,
      cwd: workspacePath,
      input: prompt,
      timeoutMs: this.config.AI_COMMAND_TIMEOUT_MS,
    });

    const validation = await this.runValidation(workspacePath);
    const output = [
      "# Builder Result",
      "",
      "## Codex Output",
      codexResult.stdout || codexResult.stderr || "No Codex output.",
      "",
      validation,
    ].join("\n");

    return {
      ok: codexResult.ok && !validation.includes("VALIDATION_FAILED"),
      output,
      error: codexResult.ok ? extractValidationError(validation) : formatCliError(codexResult),
    };
  }

  private async runValidation(workspacePath: string): Promise<string> {
    const sections: string[] = ["## Builder Validation"];

    if (this.config.BUILDER_DIFF_COMMAND) {
      sections.push(await runOptionalStep("Diff", this.config.BUILDER_DIFF_COMMAND, workspacePath));
    }

    if (this.config.BUILDER_TEST_COMMAND) {
      sections.push(await runOptionalStep("Test", this.config.BUILDER_TEST_COMMAND, workspacePath));
    }

    if (this.config.BUILDER_BUILD_COMMAND) {
      sections.push(await runOptionalStep("Build", this.config.BUILDER_BUILD_COMMAND, workspacePath));
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
