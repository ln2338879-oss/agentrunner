import type { RuntimeConfig } from "../config";
import type { AgentAdapter, AgentRole } from "../runtime/types";
import type { RoleDefinition } from "../roles/types";

export type ProviderKind =
  | "claude-code"
  | "codex"
  | "ollama"
  | "nanobanana"
  | "gemini-image"
  | "openai"
  | "gemini"
  | "anthropic"
  | "command"
  | "mock";

export interface ProviderHealth {
  id: string;
  kind: ProviderKind;
  ok: boolean;
  detail: string;
}

export interface AgentProviderFactoryInput {
  role: AgentRole;
  roleDefinition?: RoleDefinition;
  config: RuntimeConfig;
}

export interface AgentProviderFactory {
  id: string;
  kind: ProviderKind;
  createAgent(input: AgentProviderFactoryInput): AgentAdapter;
  healthCheck?(config: RuntimeConfig): Promise<ProviderHealth>;
}
