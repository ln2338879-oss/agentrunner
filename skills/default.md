# Default AgentRunner Skill

Use this context for all AgentRunner tasks unless a group-specific skill overrides it.

## General Rules

- Keep outputs concise and actionable.
- Prefer game-development-ready artifacts: Markdown specs, JSON drafts, task reports, and clear file paths.
- For code tasks, report changed files, validation commands, and known risks.
- For content tasks, prefer structured data that can be imported into a game project.
- Do not mark work as complete unless the result is reviewable by the Director.

## Review Expectations

Director reviews must start with one verdict line:

```text
VERDICT: APPROVED
VERDICT: NEEDS_REVISION
VERDICT: BLOCKED
```

Follow the verdict with concrete reasons and next actions.
