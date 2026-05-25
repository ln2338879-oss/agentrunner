# AgentRunner Role Registry

The role registry is the first step toward making AgentRunner a generic multi-agent runtime instead of a game-development-only runtime.

Existing legacy roles remain supported:

| Legacy role | Generic role |
|---|---|
| `director` | `planner` |
| `builder` | `builder` |
| `factory` | `generator` |

Additional generic roles can be added through `configs/roles.yaml`.

## Configuration

Copy the example file:

```bash
cp configs/roles.example.yaml configs/roles.yaml
```

Set the path in `.env`:

```env
ROLES_CONFIG_PATH=./configs/roles.yaml
```

A role definition can specify:

- `id`
- `label`
- `legacyRole`
- `provider`
- `model`
- `command`
- `fallbackCommands`
- `capabilities`
- `permissions`
- `timeoutMs`
- `systemPrompt`

## Providers

Supported provider identifiers:

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

## Capabilities

Supported capability identifiers:

```text
plan
implement
review
arbitrate
generate-content
research
operate
run-tests
write-files
```

## Permission model

Permissions are intentionally explicit:

```yaml
permissions:
  canWriteFiles: true
  canRunCommands: true
  canRunTests: true
  canReview: false
  canArbitrate: false
  canCreateTasks: false
  requiresReview: true
```

This lets future workflow and policy layers decide which role may write files, run shell commands, approve results, or resolve conflicts.

## Migration plan

1. Keep `director`, `builder`, and `factory` as aliases.
2. Introduce generic roles such as `planner`, `generator`, `reviewer`, `arbiter`, and `researcher`.
3. Move workflow routing from hard-coded roles to role capabilities.
4. Add workspace/profile-specific role overrides.
5. Use the registry as the source of truth for workflow and policy decisions.
