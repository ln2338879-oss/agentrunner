import type { RuntimeConfig } from "../config";
import type { AgentAdapter, AgentRunInput, AgentRunResult } from "../runtime/types";
import { buildCliPrompt } from "../utils/prompt";
import { formatFailoverHeader, parseCommandCandidates, runCommandWithFailover } from "./failover";

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

    const candidate = await runCommandWithFailover({
      commands: parseCommandCandidates(this.config.CLAUDE_CODE_COMMAND, this.config.CLAUDE_CODE_COMMANDS),
      cwd: input.workspacePath ?? this.config.PROJECT_ROOT,
      prompt,
      timeoutMs: this.config.AI_COMMAND_TIMEOUT_MS,
      enabled: this.config.ENABLE_AGENT_FAILOVER,
    });

    return {
      ok: candidate.result.ok,
      output: formatFailoverHeader(candidate) + (candidate.result.stdout || candidate.result.stderr),
      error: candidate.result.ok ? undefined : formatCliError(candidate.result),
    };
  }
}

function formatCliError(result: { exitCode: number | null; stderr: string; timedOut: boolean }): string {
  if (result.timedOut) return "Claude Code command timed out.";
  return `Claude Code command failed with exit code ${result.exitCode}.\n${result.stderr}`;
}
