import type { AgentAdapter, AgentRunInput, AgentRunResult } from "../runtime/types";

export class BuilderAgent implements AgentAdapter {
  readonly role = "builder" as const;

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    return {
      ok: true,
      output: [
        "# Builder Task Stub",
        "",
        `Task: ${input.taskId}`,
        "",
        "Builder is responsible for implementation, debugging, tests, build fixes, and diff summaries.",
        "Connect this adapter to Codex CLI when ready.",
        "",
        "## Prompt",
        input.prompt,
      ].join("\n"),
    };
  }
}
