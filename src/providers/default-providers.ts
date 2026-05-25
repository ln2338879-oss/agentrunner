import { BuilderAgent } from "../agents/builder";
import { DirectorAgent } from "../agents/director";
import { FactoryAgent } from "../agents/factory";
import type { AgentAdapter, AgentRole } from "../runtime/types";
import type { AgentProviderFactory, AgentProviderFactoryInput, ProviderHealth } from "./types";

function assertRole(input: AgentProviderFactoryInput, expected: AgentRole): void {
  if (input.role !== expected) {
    throw new Error(`Provider ${input.roleDefinition?.provider ?? "unknown"} cannot create agent for role ${input.role}; expected ${expected}.`);
  }
}

export const ClaudeCodeProviderFactory: AgentProviderFactory = {
  id: "claude-code",
  kind: "claude-code",
  createAgent(input: AgentProviderFactoryInput): AgentAdapter {
    assertRole(input, "director");
    return new DirectorAgent(input.config);
  },
  async healthCheck(config): Promise<ProviderHealth> {
    return {
      id: "claude-code",
      kind: "claude-code",
      ok: Boolean(config.CLAUDE_CODE_COMMAND),
      detail: config.CLAUDE_CODE_COMMAND ? `Command configured: ${config.CLAUDE_CODE_COMMAND}` : "CLAUDE_CODE_COMMAND is not configured.",
    };
  },
};

export const CodexProviderFactory: AgentProviderFactory = {
  id: "codex",
  kind: "codex",
  createAgent(input: AgentProviderFactoryInput): AgentAdapter {
    assertRole(input, "builder");
    return new BuilderAgent(input.config);
  },
  async healthCheck(config): Promise<ProviderHealth> {
    return {
      id: "codex",
      kind: "codex",
      ok: Boolean(config.CODEX_COMMAND),
      detail: config.CODEX_COMMAND ? `Command configured: ${config.CODEX_COMMAND}` : "CODEX_COMMAND is not configured.",
    };
  },
};

export const OllamaProviderFactory: AgentProviderFactory = {
  id: "ollama",
  kind: "ollama",
  createAgent(input: AgentProviderFactoryInput): AgentAdapter {
    assertRole(input, "factory");
    return new FactoryAgent(input.config);
  },
  async healthCheck(config): Promise<ProviderHealth> {
    return {
      id: "ollama",
      kind: "ollama",
      ok: Boolean(config.OLLAMA_BASE_URL && config.OLLAMA_MODEL),
      detail: config.OLLAMA_BASE_URL && config.OLLAMA_MODEL
        ? `Endpoint/model configured: ${config.OLLAMA_BASE_URL} ${config.OLLAMA_MODEL}`
        : "OLLAMA_BASE_URL or OLLAMA_MODEL is not configured.",
    };
  },
};

export const DefaultProviderFactories: AgentProviderFactory[] = [
  ClaudeCodeProviderFactory,
  CodexProviderFactory,
  OllamaProviderFactory,
];
