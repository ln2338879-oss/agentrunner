import type { RuntimeConfig } from "../config";
import type { AgentAdapter, AgentRunInput, AgentRunResult } from "../runtime/types";
import { buildCliPrompt } from "../utils/prompt";
import { runShellCommand } from "../utils/command";

export class BuilderAgent implements AgentAdapter {
  readonly role = "builder" as const;

  constructor(private readonly config: RuntimeConfig) {}

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const prompt = buildCliPrompt({
      role: "Builder",
      taskId: input.taskId,
      prompt: input.prompt,
      workspacePath: input.workspacePath,
    });

    const result = await runShellCommand({
      command: this.config.CODEX_COMMAND,
      cwd: input.workspacePath ?? this.config.PROJECT_ROOT,
      input: prompt,
      timeoutMs: this.config.AI_COMMAND_TIMEOUT_MS,
    });

    return {
      ok: result.ok,
      output: result.stdout || result.stderr,
      error: result.ok ? undefined : formatCliError(result),
    };
  }
}

function formatCliError(result: { exitCode: number | null; stderr: string; timedOut: boolean }): string {
  if (result.timedOut) return "Codex command timed out.";
  return `Codex command failed with exit code ${result.exitCode}.\n${result.stderr}`;
}
