# Runtime Durability v1

AgentRunner should keep its simple workflow, role, and provider registry shape while borrowing the operational durability patterns that make long-running agent systems safe. This v1 slice focuses on the invariants that must exist before adding more concurrency or provider recovery.

## Included in v1

- Workflow step claims now create an attempt ledger row with an incrementing `attempt_no` and `active_run_id`.
- Step completion and failure only update runtime state when the caller owns the latest active run id.
- Stale step results are suppressed before task status, reports, reviews, artifacts, or Discord notifications are written.
- Workflow dependencies honor `continueOnFailure` when a failed dependency is intentionally allowed to unblock downstream work.
- `BLOCKED` review verdicts route to a pending arbitration step when the workflow defines one, instead of immediately ending the task.
- Task status updates in touched runtime paths use an explicit transition guard.

## Deferred Follow-ups

- Provider sessions and handoff: add provider health, poisoned session tracking, fallback provider selection, and retry policy in a dedicated provider-runtime PR.
- Human approval ledger: promote human approval from a status-only path into a workflow action with durable approval records and Discord commands.
- Delivery queue: replace direct notifier sends with a delivery table, retry states, dedupe, and stale final-delivery suppression.
- Dashboard auth and observability: add dashboard auth, audit views, provider health, active attempts, stale locks, approval requests, and delivery backlog.
- Parallel DAG scheduler: add role/provider concurrency and Promise-pool execution only after attempt ownership is proven stable.
- Versioned migrations: replace schema-init-only evolution with numbered migrations, fresh database tests, upgrade tests, backup notes, and rollback notes.

## Why This Scope

Attempt ownership and status transitions are the base layer for every later runtime improvement. Adding provider failover, delivery retries, human approvals, or parallel scheduling before stale result suppression would increase race conditions instead of improving reliability.
