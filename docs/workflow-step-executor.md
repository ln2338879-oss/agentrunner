# Workflow Step Executor

AgentRunner workflows are materialized into executable step records and can now be claimed by worker executors.

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
- lease owner
- lease expiry
- output reference
- error
- timestamps

## Ready-step claim flow

Workers now try to claim ready workflow steps before falling back to the legacy pending-task queue.

```text
WorkerPoller.pollOnce()
→ StepExecutor.runOnce()
→ RuntimeStore.claimReadyWorkflowStep()
→ dependency check
→ workflow step lease
→ agent.run()
→ report artifact
→ completed / failed step status
```

A workflow step is claimable when:

1. the step status is `pending`
2. the resolved role id matches the worker role mapping
3. all `dependsOn` steps are `completed` or `skipped`
4. the step is unlocked or its lease expired
5. the parent task is still open

## Role mapping

Runtime workers use `AgentRole`, while workflow rows store resolved role ids.

```text
director → planner
builder  → builder
factory  → generator
designer → designer
```

## Current execution behavior

The stable Orchestrator loop still exists and still updates workflow step state.

The new independent path is:

```text
workflow step ledger
→ ready-step claim
→ role-specific worker execution
→ workflow_step_report artifact
```

This means isolated workers can now execute a specific ready workflow step instead of only claiming whole pending tasks.

## Dashboard support

Dashboard task details include:

```text
workflowSteps
```

The task timeline includes events with:

```text
kind: workflow_step
```

The root dashboard also shows workflow step counts by status.

## Current scope

Implemented now:

1. durable step leases
2. ready-step dependency gating
3. role-specific step claiming
4. StepExecutor one-step execution
5. worker poller step-first behavior
6. step report artifacts
7. failed required step marks task failed

Still intentionally limited:

1. Director/reviewer/arbiter step execution still needs a dedicated review-step executor path.
2. Human approval gates are not yet first-class workflow steps.
3. Parallel multi-step execution is now structurally possible but not yet coordinated by a scheduler process.
4. Retry-with-different-agent still needs policy and provider fallback integration.

## Next phase

The next step is a scheduler loop that continuously claims and dispatches ready steps across roles:

```text
StepScheduler
→ scan ready steps
→ claim by resolved role
→ dispatch to role agent/provider
→ wait / poll / notify
→ advance dependent steps
```
