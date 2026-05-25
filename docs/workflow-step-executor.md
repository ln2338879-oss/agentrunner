# Workflow Step Executor

AgentRunner workflows are materialized into executable step records and can now be claimed by worker executors or drained by the workflow step scheduler.

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

Workers try to claim ready workflow steps before falling back to the legacy pending-task queue.

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

## StepScheduler loop

`StepScheduler` runs the same `StepExecutor` path across multiple roles in a cycle.

```text
StepScheduler.runCycle()
→ director sweep
→ builder sweep
→ factory sweep
→ designer sweep
→ director sweep
→ repeat until idle or max steps reached
```

The default role order is:

```text
director → builder → factory → designer → director
```

The second Director pass lets a single cycle drain flows like:

```text
plan → build → review
```

Use the CLI scripts:

```bash
bun run scheduler
bun run scheduler:once
```

Relevant environment variables:

```env
STEP_SCHEDULER_INTERVAL_MS=5000
STEP_SCHEDULER_MAX_STEPS_PER_CYCLE=20
STEP_SCHEDULER_ONCE=false
```

## Role mapping

Runtime workers use `AgentRole`, while workflow rows store resolved role ids.

```text
director → planner, reviewer, arbiter
builder  → builder
factory  → generator
designer → designer
```

`director` intentionally claims multiple resolved role ids so one Director agent can execute planning, review, and arbitration steps.

## Director step behavior

`StepExecutor` treats Director-family steps specially:

```text
plan      → planning prompt, normal workflow_step_report
review    → verdict prompt, workflow_step_review + director_review
arbitrate → verdict prompt, workflow_step_review + director_review
```

Review and arbitration steps must return a verdict line such as:

```text
VERDICT: APPROVED
VERDICT: NEEDS_REVISION
VERDICT: BLOCKED
VERDICT: NEEDS_HUMAN
VERDICT: SPLIT_TASK
VERDICT: RETRY_WITH_DIFFERENT_AGENT
```

The verdict is parsed and reflected in task status. `APPROVED` marks the task approved and skips pending optional steps, such as `arbitrate-if-blocked`.

## Current execution behavior

The stable Orchestrator loop still exists and still updates workflow step state.

The independent path is:

```text
workflow step ledger
→ ready-step claim
→ role-specific worker execution
→ workflow_step_report / workflow_step_review artifact
→ dependent steps become claimable
```

The scheduler now coordinates this path continuously, so the system can move through ready workflow steps without manually starting one worker poll at a time.

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
4. worker poller step-first behavior
5. builder/factory/designer step execution
6. director planner/reviewer/arbiter step execution
7. review verdict parsing and task status updates
8. step report and review artifacts
9. scheduler run-cycle and run-loop modes
10. scheduler CLI scripts
11. failed required step marks task failed

Still intentionally limited:

1. Human approval gates are not yet first-class workflow steps.
2. Parallel multi-step execution is structurally possible, but scheduler execution is still single-process/sequential per cycle.
3. Retry-with-different-agent still needs policy and provider fallback integration.
4. Revision loops from independent review steps need a dedicated requeue/revision policy.
