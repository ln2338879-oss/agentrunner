# Deployment Guide

AgentRunner can run on a local machine, mini PC, or VPS. For a long-running Discord bot setup, use a process manager such as systemd or PM2.

## Recommended Paths

```text
/opt/agentrunner
/opt/game-projects/runebound
/opt/obsidian-vaults/AgentRunnerVault
/var/log/agentrunner
```

## Basic Setup

1. Clone the repository to the server.
2. Install Bun.
3. Run `bun install --frozen-lockfile`.
4. Copy `.env.example` to `.env`.
5. Fill Discord tokens, channel IDs, AI commands, project paths, and vault paths.
6. Run `bun run quality:check`.
7. Run `bun run start` once to verify startup.

## systemd

A systemd template is available at:

```text
deploy/systemd/agentrunner.service
```

Adjust these values before installing it:

```text
WorkingDirectory
EnvironmentFile
ExecStart
User
Group
ReadWritePaths
```

Useful service commands:

```bash
systemctl status agentrunner
journalctl -u agentrunner -f
systemctl restart agentrunner
```

## PM2

A PM2 template is available at:

```text
deploy/pm2/ecosystem.config.cjs
```

Adjust the `cwd`, log paths, and environment before use.

## Required External Commands

Depending on enabled agents, the server should have working commands for:

```text
claude
codex
ollama
```

`PROJECT_ROOT` points to the game project that Builder may modify. `OBSIDIAN_VAULT_PATH` stores task notes, reviews, reports, and approved outputs. `DATABASE_PATH` stores SQLite runtime state.
