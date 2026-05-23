import type { AgentAdapter, AgentRunInput, AgentRunResult } from "../runtime/types";

export class FactoryAgent implements AgentAdapter {
  readonly role = "factory" as const;

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    return {
      ok: true,
      output: [
        "# Factory Output Stub",
        "",
        `Task: ${input.taskId}`,
        "",
        "Factory is responsible for bulk game content drafts, JSON/CSV drafts, dialogue, quests, and asset prompts.",
        "Connect this adapter to Ollama's OpenAI-compatible endpoint when ready.",
        "",
        "## Prompt",
        input.prompt,
      ].join("\n"),
    };
  }
}
