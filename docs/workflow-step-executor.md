# Workflow Step Executor Ledger

AgentRunner workflows are now materialized into executable step records.

This is the transition point from workflow metadata to real team execution.

## What is stored

When a task is created with a workflow plan, AgentRunner initializes `workflow_step_runs` rows:

```text
pending → running → completed | skipped | failed
```

Each row stores:

- task id
- workflow id
- step id
- step index
- role alias
- resolved role id
- action
- dependency list
- required flag
- review requirement flag
- output reference
- error
- timestamps

## Current execution behavior

The current Orchestrator still runs the existing stable loop:

```text
task creation
→ synthetic plan step completion
→ primary worker step execution
→ review step execution
→ approved / revision / terminal verdict
```

The difference is that each workflow step now has a durable state row that can be inspected by the dashboard and future executors.

## Dashboard support

Dashboard task details now include:

```text
workflowSteps
```

The task timeline includes events with:

```text
kind: workflow_step
```

The root dashboard also shows workflow step counts by status.

## Why this matters

Before this change, workflow plans were stored as metadata only. After this change, workflows have a persistent execution ledger.

This enables the next phase:

1. independent per-step claiming
2. dependency checks
3. parallel-ready DAG execution
4. human approval gates per step
5. worker bots directly claiming role-specific workflow steps
6. retry with different provider/agent based on failed step state

## Current limitations

This is not yet a full DAG executor. It intentionally keeps the existing Orchestrator behavior stable while adding a durable step ledger.

Follow-up work should move from:

```text
Orchestrator loop updates step rows
```

to:

```text
StepExecutor claims ready steps and dispatches agents independently
```
