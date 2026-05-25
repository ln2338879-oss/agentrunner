# AgentRunner Provider Registry

The provider registry is the compatibility layer between generic role definitions and concrete agent adapters.

Current runtime roles still use the existing adapters:

| Runtime role | Default provider | Adapter |
|---|---|---|
| `director` | `claude-code` | `DirectorAgent` |
| `builder` | `codex` | `BuilderAgent` |
| `factory` | `ollama` | `FactoryAgent` |

## Why this exists

AgentRunner is moving from hard-coded agent construction to a provider registry that can support multiple provider kinds:

```text
claude-code
codex
ollama
openai
gemini
anthropic
command
mock
```

This lets future role definitions choose providers without changing the orchestration layer.

## Runtime behavior

`src/index.ts` now creates the default runtime agents through the provider registry:

```ts
const roleRegistry = await RoleRegistry.load({ path: config.ROLES_CONFIG_PATH });
const providerRegistry = createDefaultProviderRegistry();

for (const agent of providerRegistry.createDefaultAgents({ config, roleRegistry })) {
  orchestrator.registerAgent(agent);
}
```

The actual agent adapters are unchanged in this step. This PR only moves construction behind a registry.

## Adding a provider

A provider factory implements:

```ts
interface AgentProviderFactory {
  id: string;
  kind: ProviderKind;
  createAgent(input: AgentProviderFactoryInput): AgentAdapter;
  healthCheck?(config: RuntimeConfig): Promise<ProviderHealth>;
}
```

Then register it:

```ts
const registry = new ProviderRegistry();
registry.register(myProviderFactory);
```

## Migration path

1. Keep existing `DirectorAgent`, `BuilderAgent`, and `FactoryAgent` stable.
2. Create provider factories for each existing adapter.
3. Route agent construction through `ProviderRegistry`.
4. Add new provider factories for OpenAI, Gemini, Anthropic API, and command-based custom tools.
5. Use role/profile/workspace configuration to select providers per workflow or workspace.
