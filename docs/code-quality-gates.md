# Code Quality Gates

AgentRunner uses CI as the source of truth for reproducible quality gates.

## Commands

```bash
bun run quality:check
bun run quality:budget
```

`quality:check` runs typecheck, lint, format check, and tests.
`quality:budget` reads `code-quality-budgets.json` and verifies structural budgets that should remain deterministic across machines.

## Budgets

The current budgets track:

- `runtime-store.ts` facade size
- largest TypeScript file size
- minimum test file count
- required GitHub Actions diagnostic artifacts

## CI Evidence

The GitHub Actions quality gate uploads logs for:

- typecheck
- lint
- test
- build

These logs are uploaded even when the corresponding command fails.

## Pre-commit/Husky Decision

Husky/pre-commit hooks are deferred for now.

Reason: local hooks add setup and platform assumptions. The MVP keeps the enforceable gate in CI and exposes the same checks through `bun run quality:check` and `bun run quality:budget` for local use.
