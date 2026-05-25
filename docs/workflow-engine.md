# AgentRunner Workflow Engine

The workflow engine defines reusable multi-agent task flows without changing the existing runtime execution path yet. It is the next migration step after the generic role registry.

Workflows reference roles by role id or alias. For example, `director` still resolves to the generic `planner` role through the role registry.

## Configuration

Copy the example workflow config:

```bash
cp configs/workflows.example.yaml configs/workflows.yaml
```

Set the path in `.env`:

```env
WORKFLOWS_CONFIG_PATH=./configs/workflows.yaml
```

## Workflow definition

```yaml
workflows:
  - id: plan-build-review
    label: Plan, Build, Review
    defaultForTaskTypes:
      - implementation
    steps:
      - id: plan
        role: planner
        action: plan
      - id: build
        role: builder
        action: implement
        dependsOn:
          - plan
      - id: review
        role: reviewer
        action: review
        dependsOn:
          - build
```

## Supported actions

```text
classify
plan
implement
generate-content
research
review
arbitrate
summarize
notify
```

## Built-in workflows

| Workflow | Purpose |
|---|---|
| `direct-run` | Minimal planning/routing workflow |
| `plan-build-review` | General coding or automation workflow |
| `plan-generate-review` | Content, data, asset, or writing generation workflow |
| `research-report` | Generic research and report workflow |

## Validation

The engine validates:

- duplicate step ids
- unknown roles
- unknown dependencies

The registry can also produce a workflow plan where every step has a resolved role id and review requirement.

## Migration plan

1. Keep the current runtime execution path intact.
2. Use workflow plans for routing previews and future dashboard display.
3. Connect task classification to workflow selection.
4. Execute workflow steps through existing worker/adapter code.
5. Add policy checks before write, shell, test, and approval actions.
