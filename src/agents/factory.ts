import type { RuntimeConfig } from "../config";
import type { AgentAdapter, AgentRunInput, AgentRunResult } from "../runtime/types";
import { buildCliPrompt } from "../utils/prompt";

interface OllamaChatResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: string;
}

export class FactoryAgent implements AgentAdapter {
  readonly role = "factory" as const;

  constructor(private readonly config: RuntimeConfig) {}

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const prompt = buildCliPrompt({
      role: "Factory",
      taskId: input.taskId,
      prompt: input.prompt,
      workspacePath: input.workspacePath,
    });

    try {
      const response = await fetch(`${trimTrailingSlash(this.config.OLLAMA_BASE_URL)}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.config.OLLAMA_MODEL,
          messages: [
            {
              role: "system",
              content: "You are the AgentRunner Factory. Generate structured game-development content drafts in Markdown, JSON, CSV, or tables when requested.",
            },
            { role: "user", content: prompt },
          ],
          stream: false,
        }),
      });

      const body = (await response.json()) as OllamaChatResponse;
      const output = body.choices?.[0]?.message?.content ?? body.error ?? "";

      return {
        ok: response.ok && output.length > 0,
        output,
        error: response.ok ? undefined : `Ollama request failed with HTTP ${response.status}: ${output}`,
      };
    } catch (error) {
      return {
        ok: false,
        output: "",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
