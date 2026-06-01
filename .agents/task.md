# Task

Improve AgentRunner in priority order, then publish to GitHub `main`.

## Required improvements

1. Unify the inline Orchestrator path and StepExecutor path so duplicated workflow execution/review logic is no longer the main risk.
2. Fix ReviewVerdict type, parser, and task status mapping consistency.
3. Split RuntimeStore and consolidate duplicated helpers.
4. Integrate risk detection more deeply with the policy engine instead of keeping risk-gate style detection separate from policy decisions.
5. Remove obfuscated code such as `["g","i","t"].join("")`.

## Constraints

- Keep changes scoped and surgical.
- Preserve existing user/worktree changes unless directly required.
- Verify with tests/typecheck before pushing.
- If GitHub push to `main` requires user authentication, stop and wait for the user.
