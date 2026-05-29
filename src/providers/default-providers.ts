import { BuilderAgent } from "../agents/builder";
import { DesignerAgent } from "../agents/designer";
import { DirectorAgent } from "../agents/director";
import { FactoryAgent } from "../agents/factory";
import type { RuntimeConfig } from "../config";
import type { AgentAdapter, AgentRole } from "../runtime/types";
import { withTaskWorkspaceIsolation } from "../safety/workspace-agent";
import type { AgentProviderFactory, AgentProviderFactoryInput, ProviderHealth, ProviderKind } from "./types";

function assertRole(input: AgentProviderFactoryInput, expected: AgentRole): void {
  if (input.role !== expected) {
    throw new Error(`Provider ${input.roleDefinition?.provider ?? "unknown"} cannot create agent for role ${input.role}; expected ${expected}.`);
  }
}

function isolated(agent: AgentAdapter, config: RuntimeConfig): AgentAdapter {
  return withTaskWorkspaceIsolation(agent, config);
}

function imageProviderHealth(config: RuntimeConfig, id: "nanobanana" | "gemini-image", kind: ProviderKind): ProviderHealth {
  return {
    id,
    kind,
    ok: Boolean(config.GEMINI_API_KEY && config.GEMINI_IMAGE_MODEL),
    detail: config.GEMINI_API_KEY
      ? `Image model configured: ${config.GEMINI_IMAGE_MODEL}`
      : "GEMINI_API_KEY is not configured.",
  };
}

export const ClaudeCodeProviderFactory: AgentProviderFactory = {
  id: "claude-code",
  kind: "claude-code",
  createAgent(input: AgentProviderFactoryInput): AgentAdapter {
    assertRole(input, "director");
    return isolated(new DirectorAgent(input.config), input.config);
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
    return isolated(new BuilderAgent(input.config), input.config);
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
    return isolated(new FactoryAgent(input.config), input.config);
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

export const NanoBananaProviderFactory: AgentProviderFactory = {
  id: "nanobanana",
  kind: "nanobanana",
  createAgent(input: AgentProviderFactoryInput): AgentAdapter {
    assertRole(input, "designer");
    return isolated(new DesignerAgent(input.config), input.config);
  },
  async healthCheck(config): Promise<ProviderHealth> {
    return imageProviderHealth(config, "nanobanana", "nanobanana");
  },
};

export const GeminiImageProviderFactory: AgentProviderFactory = {
  id: "gemini-image",
  kind: "gemini-image",
  createAgent(input: AgentProviderFactoryInput): AgentAdapter {
    assertRole(input, "designer");
    return isolated(new DesignerAgent(input.config), input.config);
  },
  async healthCheck(config): Promise<ProviderHealth> {
    return imageProviderHealth(config, "gemini-image", "gemini-image");
  },
};

export const DefaultProviderFactories: AgentProviderFactory[] = [
  ClaudeCodeProviderFactory,
  CodexProviderFactory,
  OllamaProviderFactory,
  NanoBananaProviderFactory,
  GeminiImageProviderFactory,
];
