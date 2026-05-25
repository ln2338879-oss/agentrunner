import type { RuntimeConfig } from "../config";
import type { AgentAdapter, AgentRunInput, AgentRunResult } from "../runtime/types";
import { buildCliPrompt } from "../utils/prompt";
import { formatFailoverHeader, parseCommandCandidates, runCommandWithFailover } from "./failover";

export class DirectorAgent implements AgentAdapter {
  readonly role = "director" as const;

  constructor(private readonly config: RuntimeConfig) {}

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const config = input.runtimeConfig ?? this.config;
    const workspacePath = input.workspacePath ?? config.PROJECT_ROOT;
    const prompt = buildCliPrompt({
      role: "Director",
      taskId: input.taskId,
      prompt: input.prompt,
      workspacePath,
    });

    const candidate = await runCommandWithFailover({
      commands: parseCommandCandidates(config.CLAUDE_CODE_COMMAND, config.CLAUDE_CODE_COMMANDS),
      cwd: workspacePath,
      prompt,
      timeoutMs: config.AI_COMMAND_TIMEOUT_MS,
      enabled: config.ENABLE_AGENT_FAILOVER,
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
