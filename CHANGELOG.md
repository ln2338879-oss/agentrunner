# Changelog

All notable changes to AgentRunner will be documented in this file.

## Unreleased

### Added

- Discord 3-bot runtime architecture: Director, Builder, Factory.
- Discord text commands: `!help`, `!tasks`, `!task`, `!retry`.
- Discord slash commands: `/help`, `/tasks`, `/task`, `/retry`, `/run`.
- SQLite WAL runtime state with tasks, task runs, messages, reviews, artifacts, and task leases.
- Obsidian Vault output structure for tasks, reviews, builder reports, factory outputs, approved summaries, and recovery notes.
- ClaudeCode CLI, Codex CLI, and Ollama-compatible Factory adapters.
- Director review loop with `APPROVED`, `NEEDS_REVISION`, and `BLOCKED` verdicts.
- Automatic revision loop up to `MAX_REVIEW_ROUNDS`.
- Builder diff/test/build validation reports.
- Startup stale-task recovery.
- Runtime Discord notifications for worker reports, reviews, failures, approvals, and recovery.
- GitHub Actions quality gate: install, typecheck, lint, format check, test, and build.
- GitHub Actions approved-task PR workflow.
- Obsidian Dataview dashboard templates.
- Group configuration path and skill directory configuration.

### Planned

- systemd and PM2 deployment templates.
- Group/room-level runtime overrides.
- Skill context synchronization into agent prompts.
- Discord attachment and image context handling.
- Session persistence and mid-turn steering support.
- Web dashboard.
