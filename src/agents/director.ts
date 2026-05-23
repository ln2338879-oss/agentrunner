import type { RuntimeConfig } from "../config";
import type { AgentAdapter, AgentRunInput, AgentRunResult } from "../runtime/types";
import { buildCliPrompt } from "../utils/prompt";
import { runShellCommand } from "../utils/command";

export class DirectorAgent implements AgentAdapter {
  readonly role = "director" as const;

  constructor(private readonly config: RuntimeConfig) {}

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const prompt = buildCliPrompt({
      role: "Director",
      taskId: input.taskId,
      prompt: input.prompt,
      workspacePath: input.workspacePath,
    });

    const result = await runShellCommand({
      command: this.config.CLAUDE_CODE_COMMAND,
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
  if (result.timedOut) return "Claude Code command timed out.";
  return `Claude Code command failed with exit code ${result.exitCode}.\n${result.stderr}`;
}
