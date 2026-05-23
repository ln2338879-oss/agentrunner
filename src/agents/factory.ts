import type { RuntimeConfig } from "../config";
import type { AgentAdapter, AgentRunInput, AgentRunResult } from "../runtime/types";
import { buildCliPrompt } from "../utils/prompt";
import { formatFailoverHeader, parseCommandCandidates, runCommandWithFailover } from "./failover";

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

    const cliCommands = parseCommandCandidates("", this.config.FACTORY_COMMANDS);
    if (cliCommands.length > 0) {
      const cliResult = await runCommandWithFailover({
        commands: cliCommands,
        cwd: input.workspacePath ?? this.config.PROJECT_ROOT,
        prompt,
        timeoutMs: this.config.AI_COMMAND_TIMEOUT_MS,
        enabled: this.config.ENABLE_AGENT_FAILOVER,
      });

      if (cliResult.result.ok || !this.config.ENABLE_AGENT_FAILOVER) {
        return {
          ok: cliResult.result.ok,
          output: formatFailoverHeader(cliResult) + (cliResult.result.stdout || cliResult.result.stderr),
          error: cliResult.result.ok ? undefined : `Factory command failed with exit code ${cliResult.result.exitCode}.`,
        };
      }
    }

    return await this.runOllamaFailover(prompt);
  }

  private async runOllamaFailover(prompt: string): Promise<AgentRunResult> {
    const baseUrls = parsePipeList(this.config.OLLAMA_BASE_URL, this.config.OLLAMA_BASE_URLS);
    const models = parsePipeList(this.config.OLLAMA_MODEL, this.config.OLLAMA_MODELS);
    const failures: string[] = [];

    for (const baseUrl of baseUrls) {
      for (const model of models) {
        const result = await this.runOllamaOnce({ baseUrl, model, prompt });
        if (result.ok || !this.config.ENABLE_AGENT_FAILOVER) return result;
        failures.push(result.error ?? `Factory candidate failed: ${baseUrl} ${model}`);
      }
    }

    return {
      ok: false,
      output: "",
      error: failures.join("\n\n") || "All Factory candidates failed.",
    };
  }

  private async runOllamaOnce(input: {
    baseUrl: string;
    model: string;
    prompt: string;
  }): Promise<AgentRunResult> {
    try {
      const response = await fetch(`${trimTrailingSlash(input.baseUrl)}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: input.model,
          messages: [
            {
              role: "system",
              content: "You are the AgentRunner Factory. Generate structured game-development content drafts in Markdown, JSON, CSV, or tables when requested.",
            },
            { role: "user", content: input.prompt },
          ],
          stream: false,
        }),
      });

      const body = (await response.json()) as OllamaChatResponse;
      const output = body.choices?.[0]?.message?.content ?? body.error ?? "";

      return {
        ok: response.ok && output.length > 0,
        output: [
          "# Factory Execution",
          "",
          `base_url: ${input.baseUrl}`,
          `model: ${input.model}`,
          `ok: ${response.ok}`,
          "",
          output,
        ].join("\n"),
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

function parsePipeList(primary: string, alternates: string): string[] {
  return [...new Set([primary, ...alternates.split("||")].map((value) => value.trim()).filter(Boolean))];
}
