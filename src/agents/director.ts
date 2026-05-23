import type { AgentAdapter, AgentRunInput, AgentRunResult } from "../runtime/types";

export class DirectorAgent implements AgentAdapter {
  readonly role = "director" as const;

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    return {
      ok: true,
      output: [
        "# Director Plan",
        "",
        `Task: ${input.taskId}`,
        "",
        "Director is responsible for planning, routing, final review, and user reporting.",
        "Connect this adapter to Claude Code CLI or an Anthropic-compatible provider when ready.",
        "",
        "## Prompt",
        input.prompt,
      ].join("\n"),
    };
  }
}
