# Strict Review Automation

AgentRunner can run code work through a stricter review gate so that a worker result is not accepted only because the reviewer says `VERDICT: APPROVED`.

The strict review path is:

```text
Builder implements
→ validation commands run
→ Reviewer reviews in read-only mode
→ strict gate checks changed files, tests, and validation output
→ APPROVED is accepted only if there are no blocking strict issues
```

## Environment

```env
STRICT_REVIEW_ENABLED=true
STRICT_REVIEW_REQUIRE_TESTS=true
STRICT_REVIEW_COMMANDS=bun run typecheck||bun test
STRICT_REVIEW_COMMAND_TIMEOUT_MS=300000
STRICT_REVIEW_FAIL_ON_VALIDATION_ERROR=true
STRICT_REVIEW_BLOCK_LOCKFILE_CHANGES=false
```

## What the strict gate blocks

When `STRICT_REVIEW_ENABLED=true`, AgentRunner evaluates the review result after the reviewer returns a verdict.

A reviewer `APPROVED` can be downgraded to `NEEDS_REVISION` if any blocking issue is found:

- code files changed without matching test/spec changes
- configured validation commands fail
- validation commands cannot run and `STRICT_REVIEW_FAIL_ON_VALIDATION_ERROR=true`
- lockfile/dependency files changed and `STRICT_REVIEW_BLOCK_LOCKFILE_CHANGES=true`

This means the reviewer prompt is not the only source of truth. The runtime can independently reject approval.

## Test requirement heuristic

`STRICT_REVIEW_REQUIRE_TESTS=true` is intentionally conservative:

- files under `src/`, `app/`, `lib/`, `packages/`, or `runners/` count as code changes
- files containing `test`, `tests`, `spec`, `.test.`, or `.spec.` count as test changes
- Markdown-only and documentation-only edits do not trigger the missing-test blocker

If a change is truly not testable, the builder should either add a relevant regression check elsewhere or leave the task for human review.

## Validation commands

`STRICT_REVIEW_COMMANDS` accepts commands separated by `||` or newlines.

Example:

```env
STRICT_REVIEW_COMMANDS=bun run typecheck||bun test
```

Each command runs from `PROJECT_ROOT` when set, otherwise from the current process working directory.

## Lockfile and dependency changes

By default, lockfile/dependency changes are surfaced as risk signals but do not block approval.

Set this to block them:

```env
STRICT_REVIEW_BLOCK_LOCKFILE_CHANGES=true
```

This is useful for production deployments where dependency changes should always receive human review.

## Reviewer read-only contract

Strict review complements the existing read-only guard:

```env
REVIEW_READ_ONLY_GUARD=true
REVIEW_DIFF_COMMAND=git diff --stat && git diff --name-only && git diff --check
```

The reviewer should inspect files, run commands, and produce a review report only. If the reviewer mutates files while the guard is enabled, the review fails.

## Recommended production setting

```env
STRICT_REVIEW_ENABLED=true
STRICT_REVIEW_REQUIRE_TESTS=true
STRICT_REVIEW_COMMANDS=bun run typecheck||bun test
STRICT_REVIEW_FAIL_ON_VALIDATION_ERROR=true
STRICT_REVIEW_BLOCK_LOCKFILE_CHANGES=true
REVIEW_READ_ONLY_GUARD=true
```
