import type { RuntimeConfig } from "../config";
import { classifyProviderError, formatHumanEscalation } from "../providers/error-classifier";
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
    const config = input.runtimeConfig ?? this.config;

    const prompt = buildCliPrompt({
      role: "Factory",
      taskId: input.taskId,
      prompt: input.prompt,
      workspacePath: input.workspacePath,
    });

    const cliCommands = parseCommandCandidates("", config.FACTORY_COMMANDS);
    if (cliCommands.length > 0) {
      const cliResult = await runCommandWithFailover({
        commands: cliCommands,
        cwd: input.workspacePath ?? config.PROJECT_ROOT,
        prompt,
        timeoutMs: config.AI_COMMAND_TIMEOUT_MS,
        enabled: config.ENABLE_AGENT_FAILOVER,
        provider: "Factory CLI",
      });

      if (cliResult.classification?.needsHuman) {
        return {
          ok: false,
          output: [
            formatFailoverHeader(cliResult),
            formatHumanEscalation({
              provider: "Factory CLI",
              command: cliResult.command,
              classification: cliResult.classification,
              stderr: cliResult.result.stderr,
              stdout: cliResult.result.stdout,
            }),
          ].join("\n"),
          error: cliResult.classification.reason,
          errorKind: cliResult.classification.kind,
          needsHuman: true,
        };
      }

      if (cliResult.result.ok || !config.ENABLE_AGENT_FAILOVER) {
        return {
          ok: cliResult.result.ok,
          output: formatFailoverHeader(cliResult) + (cliResult.result.stdout || cliResult.result.stderr),
          error: cliResult.result.ok ? undefined : `Factory command failed with exit code ${cliResult.result.exitCode}.`,
          errorKind: cliResult.classification?.kind,
          needsHuman: cliResult.classification?.needsHuman,
        };
      }
    }

    return await this.runOllamaFailover(prompt, config);
  }

  private async runOllamaFailover(prompt: string, config: RuntimeConfig): Promise<AgentRunResult> {
    const baseUrls = parsePipeList(config.OLLAMA_BASE_URL, config.OLLAMA_BASE_URLS);
    const models = parsePipeList(config.OLLAMA_MODEL, config.OLLAMA_MODELS);
    const failures: string[] = [];

    for (const baseUrl of baseUrls) {
      for (const model of models) {
        const result = await this.runOllamaOnce({ baseUrl, model, prompt });
        if (result.needsHuman) return result;
        if (result.ok || !config.ENABLE_AGENT_FAILOVER) return result;
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
      const classification = response.ok ? undefined : classifyProviderError({
        provider: "Ollama",
        error: output,
        stdout: output,
      });

      if (classification?.needsHuman) {
        return {
          ok: false,
          output: formatHumanEscalation({
            provider: "Ollama",
            classification,
            stdout: output,
          }),
          error: classification.reason,
          errorKind: classification.kind,
          needsHuman: true,
        };
      }

      return {
        ok: response.ok && output.length > 0,
        output: [
          "# Factory Execution",
          "",
          `base_url: ${input.baseUrl}`,
          `model: ${input.model}`,
          `ok: ${response.ok}`,
          classification ? `error_kind: ${classification.kind}` : undefined,
          "",
          output,
        ].filter(Boolean).join("\n"),
        error: response.ok ? undefined : `Ollama request failed with HTTP ${response.status}: ${output}`,
        errorKind: classification?.kind,
        needsHuman: classification?.needsHuman,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const classification = classifyProviderError({ provider: "Ollama", error: message });
      return {
        ok: false,
        output: classification.needsHuman
          ? formatHumanEscalation({ provider: "Ollama", classification, stderr: message })
          : "",
        error: classification.needsHuman ? classification.reason : message,
        errorKind: classification.kind,
        needsHuman: classification.needsHuman,
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
