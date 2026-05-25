import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config";
import { ProviderRegistry } from "../src/providers/registry";
import type { AgentProviderFactory } from "../src/providers/types";
import type { AgentRunInput, AgentRunResult } from "../src/runtime/types";
import { RoleRegistry } from "../src/roles/registry";
import type { RoleDefinition } from "../src/roles/types";

const config = loadConfig({
  CLAUDE_CODE_COMMAND: "claude",
  CODEX_COMMAND: "codex",
  OLLAMA_BASE_URL: "http://localhost:11434/v1",
  OLLAMA_MODEL: "gemma",
  GEMINI_API_KEY: "test-key",
  GEMINI_IMAGE_MODEL: "gemini-3.1-flash-image-preview",
});

const baseRoleDefinition = {
  fallbackCommands: [],
  capabilities: [],
  permissions: {
    canWriteFiles: false,
    canRunCommands: false,
    canRunTests: false,
    canReview: false,
    canArbitrate: false,
    canCreateTasks: false,
    requiresReview: true,
  },
};

describe("ProviderRegistry", () => {
  test("creates default runtime role agents", () => {
    const registry = new ProviderRegistry();
    const agents = registry.createDefaultAgents({ config });

    expect(agents.map((agent) => agent.role)).toEqual(["director", "builder", "factory", "designer"]);
  });

  test("uses role registry provider definitions when resolving role providers", () => {
    const roles: RoleDefinition[] = [
      {
        ...baseRoleDefinition,
        id: "planner",
        legacyRole: "director",
        provider: "claude-code",
      },
      {
        ...baseRoleDefinition,
        id: "builder",
        legacyRole: "builder",
        provider: "codex",
      },
      {
        ...baseRoleDefinition,
        id: "generator",
        legacyRole: "factory",
        provider: "ollama",
      },
      {
        ...baseRoleDefinition,
        id: "designer",
        legacyRole: "designer",
        provider: "nanobanana",
      },
    ];
    const roleRegistry = new RoleRegistry({ roles, aliases: {} });

    const registry = new ProviderRegistry();
    expect(registry.createAgentForRole({ role: "director", config, roleRegistry }).role).toBe("director");
    expect(registry.createAgentForRole({ role: "builder", config, roleRegistry }).role).toBe("builder");
    expect(registry.createAgentForRole({ role: "factory", config, roleRegistry }).role).toBe("factory");
    expect(registry.createAgentForRole({ role: "designer", config, roleRegistry }).role).toBe("designer");
  });

  test("supports registering custom provider factories", async () => {
    const customFactory: AgentProviderFactory = {
      id: "mock",
      kind: "mock",
      createAgent() {
        return {
          role: "director",
          async run(_input: AgentRunInput): Promise<AgentRunResult> {
            return { ok: true, output: "mock output" };
          },
        };
      },
      async healthCheck() {
        return { id: "mock", kind: "mock", ok: true, detail: "mock ok" };
      },
    };

    const registry = new ProviderRegistry([]);
    registry.register(customFactory);

    expect(registry.require("mock").id).toBe("mock");
    expect((await registry.healthCheck(config))[0]).toEqual({ id: "mock", kind: "mock", ok: true, detail: "mock ok" });
  });

  test("reports health for default providers", async () => {
    const registry = new ProviderRegistry();
    const health = await registry.healthCheck(config);

    expect(health.map((item) => item.id)).toEqual(["claude-code", "codex", "ollama", "nanobanana", "gemini-image"]);
    expect(health.every((item) => item.ok)).toBe(true);
  });
});
