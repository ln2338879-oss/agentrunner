import type { RuntimeConfig } from "../config";
import type { AgentAdapter, AgentRole } from "../runtime/types";
import { RoleRegistry } from "../roles/registry";
import type { RoleDefinition } from "../roles/types";
import { DefaultProviderFactories } from "./default-providers";
import type { AgentProviderFactory, ProviderHealth, ProviderKind } from "./types";

export class ProviderRegistry {
  private readonly factories = new Map<string, AgentProviderFactory>();

  constructor(factories: AgentProviderFactory[] = DefaultProviderFactories) {
    for (const factory of factories) this.register(factory);
  }

  register(factory: AgentProviderFactory): void {
    this.factories.set(factory.id, factory);
  }

  get(providerId: string): AgentProviderFactory | null {
    return this.factories.get(providerId) ?? null;
  }

  require(providerId: string): AgentProviderFactory {
    const factory = this.get(providerId);
    if (!factory) throw new Error(`Unknown provider: ${providerId}`);
    return factory;
  }

  list(): AgentProviderFactory[] {
    return [...this.factories.values()];
  }

  createAgentForRole(input: {
    role: AgentRole;
    config: RuntimeConfig;
    roleRegistry?: RoleRegistry;
  }): AgentAdapter {
    const roleDefinition = resolveRoleDefinition(input.role, input.roleRegistry);
    const providerId = providerForLegacyRole(input.role, roleDefinition);
    const factory = this.require(providerId);
    return factory.createAgent({
      role: input.role,
      roleDefinition,
      config: input.config,
    });
  }

  createDefaultAgents(input: {
    config: RuntimeConfig;
    roleRegistry?: RoleRegistry;
  }): AgentAdapter[] {
    return (["director", "builder", "factory", "designer"] as AgentRole[]).map((role) => (
      this.createAgentForRole({ role, config: input.config, roleRegistry: input.roleRegistry })
    ));
  }

  async healthCheck(config: RuntimeConfig): Promise<ProviderHealth[]> {
    return await Promise.all(this.list().map(async (factory) => {
      if (!factory.healthCheck) {
        return {
          id: factory.id,
          kind: factory.kind,
          ok: true,
          detail: "No health check defined.",
        };
      }
      return factory.healthCheck(config);
    }));
  }
}

export function createDefaultProviderRegistry(): ProviderRegistry {
  return new ProviderRegistry();
}

function resolveRoleDefinition(role: AgentRole, roleRegistry?: RoleRegistry): RoleDefinition | undefined {
  if (!roleRegistry) return undefined;
  return roleRegistry.resolve(role) ?? undefined;
}

function providerForLegacyRole(role: AgentRole, roleDefinition?: RoleDefinition): ProviderKind {
  if (roleDefinition?.provider) return roleDefinition.provider;
  if (role === "director") return "claude-code";
  if (role === "builder") return "codex";
  if (role === "factory") return "ollama";
  return "nanobanana";
}
